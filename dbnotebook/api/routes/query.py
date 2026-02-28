"""Programmatic API for RAG queries with optional conversation memory.

Provides a unified API for programmatic access:
- POST /api/query - Execute query with optional session_id for conversation memory
- GET /api/query/notebooks - List available notebooks
- GET /api/user/api-key - Get current user's API key

Conversation Memory:
- Omit session_id → stateless query (no history saved, no session_id returned)
- Pass session_id → conversational mode (loads history, saves Q&A, returns session_id)

Important: Client must generate and send session_id (UUID format) from the FIRST request
if conversation memory is desired. The server does not generate session IDs.

Designed for:
- API integrations
- Scripting and automation
- Conversational AI agents
- Multi-turn Q&A workflows

API Key Authentication:
- API keys are stored per-user in the database (users.api_key)
- Requests must include X-API-Key header matching a valid user's API key
- Environment variable API_KEY is used as fallback for backward compatibility

RBAC Integration:
- Set RBAC_STRICT_MODE=true to enforce notebook access control
- Users must have viewer access or higher to query notebooks
"""

import logging
import time
from flask import request, jsonify

from llama_index.core import Settings
from llama_index.core.schema import QueryBundle

from dbnotebook.api.core.decorators import require_api_key, set_db_manager
from dbnotebook.api.core.response import (
    success_response, error_response, not_found, validation_error,
    forbidden, service_unavailable
)
from dbnotebook.core.auth import check_notebook_access, AccessLevel
from dbnotebook.core.constants import DEFAULT_USER_ID
from dbnotebook.core.prompt import get_condense_prompt

logger = logging.getLogger(__name__)

# In-memory session store for Query API (ephemeral, lost on restart)
# Key: session_id (str), Value: list of {"role": str, "content": str}
# This keeps Query API memory isolated from RAG Chat (which uses DB)
_query_sessions: dict[str, list[dict[str, str]]] = {}


def get_api_format_instructions(response_format: str) -> str:
    """Get API-specific formatting instructions based on response_format parameter.

    Args:
        response_format: One of "default", "detailed", "analytical", "brief"

    Returns:
        Format instructions to inject into the prompt, or empty string for default
    """
    if response_format == "analytical":
        return """

**ANALYTICAL RESPONSE FORMAT (API REQUEST)**:
- Extract and present ALL key data points, metrics, and figures from the documents
- Use markdown tables for comparative data, lists of items, or structured information
- Structure your response with these sections:
  1. **Key Findings** - Bullet points of most important information
  2. **Detailed Analysis** - Comprehensive breakdown with supporting data
  3. **Data Tables** - Present any numerical data, comparisons, or lists in table format
  4. **Summary** - Brief conclusion with actionable insights
- Include ALL relevant numerical values, percentages, dates, and metrics
- Do NOT omit data for brevity - this is an analytical API response"""
    elif response_format == "detailed":
        return """

**DETAILED RESPONSE FORMAT (API REQUEST)**:
- Provide comprehensive, in-depth analysis with full technical details
- Use structured headers (##, ###) to organize multiple sections
- Include all relevant evidence and examples from documents
- Do NOT abbreviate or summarize - provide complete information
- Use bullet points and numbered lists for clarity
- Aim for thorough coverage over brevity"""
    elif response_format == "brief":
        return """

**BRIEF RESPONSE FORMAT (API REQUEST)**:
- Provide concise summary in 2-3 paragraphs max
- Focus only on the most critical points
- Use bullet points for key takeaways
- Omit detailed explanations - just the essentials"""
    return ""  # default - use existing adaptive format


def create_query_routes(app, pipeline, db_manager, notebook_manager):
    """Create simple programmatic query API routes.

    Args:
        app: Flask application instance
        pipeline: LocalRAGPipeline instance
        db_manager: DatabaseManager instance
        notebook_manager: NotebookManager instance
    """
    # Set db_manager for API key validation in decorators module
    if db_manager:
        set_db_manager(db_manager)

    @app.route("/api/query", methods=["POST"])
    @require_api_key
    def api_query():
        """
        Multi-user safe programmatic API for RAG queries with optional conversation memory.

        Thread-safe for concurrent requests. Uses default LLM model configured at startup.

        **Conversation Memory:**
        - Omit `session_id` → stateless query (no history saved, no session_id returned)
        - Pass `session_id` → conversational mode (loads history, saves Q&A, returns session_id)

        **Important:** Client must generate and send session_id (UUID) from the FIRST request
        if conversation memory is desired. The server does not generate session IDs.

        Request JSON:
            {
                "notebook_id": "uuid",           # Required
                "query": "string",               # Required
                "session_id": "uuid",            # Optional - client-generated UUID for memory
                "max_history": 5,                # Optional, default: 5, max: 20 (only if session_id)
                "include_sources": true,         # Optional, default: true
                "max_sources": 6,                # Optional, default: 6, max: 20
                "model": "gpt-4.1",              # Optional - LLM model override
                "reranker_enabled": true,        # Optional - enable/disable reranking
                "reranker_model": "...",         # Optional - reranker model override
                "top_k": 6,                      # Optional - retrieval top_k override
                "skip_raptor": true,             # Optional, default: true - set false to include RAPTOR summaries
                "response_format": "analytical"  # Optional: default|detailed|analytical|brief
            }

        Response JSON (stateless - no session_id sent):
            {
                "success": true,
                "response": "LLM response text",
                "sources": [...],
                "metadata": { "stateless": true, "history_messages_used": 0 }
            }

        Response JSON (with memory - session_id sent):
            {
                "success": true,
                "response": "LLM response text",
                "session_id": "uuid",            # Same as sent, confirms memory enabled
                "sources": [...],
                "metadata": { "stateless": false, "history_messages_used": 3 }
            }
        """
        import uuid as uuid_lib

        start_time = time.time()
        timings = {}  # Track timing for each stage
        original_reranker_config = None  # Track for cleanup in finally block

        try:
            data = request.json or {}

            # Validate required fields
            notebook_id = data.get("notebook_id")
            query = data.get("query")

            if not notebook_id:
                return validation_error("notebook_id is required")

            if not query:
                return validation_error("query is required")

            # Session management - optional conversation memory
            # Client MUST send session_id to enable memory (consistency: no session_id = stateless)
            session_id_input = data.get("session_id")
            use_memory = session_id_input is not None
            session_id = None

            if session_id_input:
                try:
                    session_id = uuid_lib.UUID(session_id_input)
                except ValueError:
                    return validation_error("Invalid session_id format. Must be a valid UUID.")

            # Get user_id for RBAC check
            user_id = (
                request.headers.get("X-User-ID") or
                data.get("user_id") or
                getattr(request, 'api_user_id', None) or
                DEFAULT_USER_ID  # Default for backward compatibility
            )

            # RBAC: Check notebook access (only enforced if RBAC_STRICT_MODE=true)
            has_access, error_msg = check_notebook_access(
                user_id=user_id,
                notebook_id=notebook_id,
                access_level=AccessLevel.VIEWER
            )
            if not has_access:
                return forbidden(error_msg)

            # Optional parameters
            model_name = data.get("model")
            include_sources = data.get("include_sources", True)
            max_sources = min(data.get("max_sources", 6), 20)  # Cap at 20
            max_history = min(data.get("max_history", 5), 20) if use_memory else 0

            # Reranker config overrides (per-request, for benchmarking)
            reranker_enabled = data.get("reranker_enabled")  # None means use global setting
            reranker_model = data.get("reranker_model")  # None means use global setting
            top_k_explicit = data.get("top_k")  # None means use default
            top_k = top_k_explicit  # Start with explicit value (may be None)
            skip_raptor = data.get("skip_raptor", True)  # Default True: RAPTOR summaries can dilute precision for specific queries
            response_format = data.get("response_format", "default")  # default|detailed|analytical|brief

            # Apply adaptive top_k only when caller has not set one explicitly.
            if top_k_explicit is None:
                try:
                    from dbnotebook.core.services.parameter_optimizer_service import ParameterOptimizerService
                    _opt = ParameterOptimizerService(
                        pipeline=pipeline, db_manager=db_manager, notebook_manager=notebook_manager
                    )
                    _adap = _opt.get_adaptive_settings(notebook_id=notebook_id)
                    if _adap and _adap.get("top_k"):
                        adaptive_top_k = min(max(_adap["top_k"], max_sources), 20)
                        max_sources = adaptive_top_k
                        top_k = adaptive_top_k
                        logger.info(f"Adaptive top_k={top_k} applied to /api/query (feedback-driven default)")
                except Exception:
                    pass

            # Get LLM instance for this specific request
            from dbnotebook.core.model.model import LocalRAGModel
            llm = LocalRAGModel.set(model_name) if model_name else Settings.llm

            # Apply per-request reranker config if specified
            original_reranker_config = None
            if reranker_enabled is not None or reranker_model:
                from dbnotebook.core.providers.reranker_provider import (
                    get_reranker_config, set_reranker_config
                )
                original_reranker_config = get_reranker_config()
                set_reranker_config(
                    model=reranker_model or original_reranker_config.get("model"),
                    enabled=reranker_enabled if reranker_enabled is not None else original_reranker_config.get("enabled", True),
                    top_n=top_k or original_reranker_config.get("top_n")
                )
                logger.info(f"Per-request reranker config: enabled={reranker_enabled}, model={reranker_model}, top_k={top_k}")

            logger.info(f"API query: notebook_id={notebook_id}, session_id={session_id}, use_memory={use_memory}, model={model_name or 'default'}, response_format={response_format}")

            # Step 1: Verify notebook exists
            t1 = time.time()
            notebook = notebook_manager.get_notebook(notebook_id)
            timings["1_notebook_lookup_ms"] = int((time.time() - t1) * 1000)

            if not notebook:
                return not_found("Notebook", notebook_id)

            # Step 1.5: Load conversation history from in-memory store (ephemeral)
            # Query API uses in-memory sessions to avoid contaminating RAG Chat (DB-based)
            history_messages = []
            if use_memory and session_id:
                t1b = time.time()
                session_key = str(session_id)
                if session_key in _query_sessions:
                    # Get last N message pairs (max_history * 2 for user+assistant pairs)
                    history_messages = _query_sessions[session_key][-(max_history * 2):]
                timings["1b_load_history_ms"] = int((time.time() - t1b) * 1000)
                logger.debug(f"Loaded {len(history_messages)} history messages from in-memory session {session_id}")

            # Step 1.6: Expand follow-up queries using conversation history
            # This prevents hallucination by giving the retriever full context
            retrieval_query = query  # Default to original query
            if use_memory and history_messages and len(history_messages) >= 2:
                t1c = time.time()
                try:
                    # Format history for the condense prompt
                    history_text = "\n".join([
                        f"{'User' if msg['role'] == 'user' else 'Assistant'}: {msg['content'][:500]}"
                        for msg in history_messages[-4:]  # Last 2 exchanges
                    ])

                    # Use condense prompt to expand follow-up query
                    condense_prompt = get_condense_prompt().format(
                        chat_history=history_text,
                        question=query
                    )

                    # Use LLM to generate standalone question
                    expanded = llm.complete(condense_prompt).text.strip()

                    # Only use expanded query if it's meaningful
                    if expanded and len(expanded) > 5 and expanded != query:
                        retrieval_query = expanded
                        logger.info(f"Expanded follow-up query: '{query}' → '{retrieval_query}'")

                    timings["1c_query_expansion_ms"] = int((time.time() - t1c) * 1000)

                    # Log query expansion to metrics
                    if pipeline._query_logger:
                        try:
                            from dbnotebook.core.observability.token_counter import get_token_counter
                            token_counter = get_token_counter()
                            prompt_tokens = token_counter.count_tokens(condense_prompt)
                            completion_tokens = token_counter.count_tokens(expanded)
                            used_model = llm.model if hasattr(llm, 'model') else (model_name or 'unknown')

                            pipeline._query_logger.log_query(
                                notebook_id=notebook_id,
                                user_id=user_id,
                                query_text=f"[Query API - Query Expansion]",
                                model_name=used_model,
                                prompt_tokens=prompt_tokens,
                                completion_tokens=completion_tokens,
                                response_time_ms=timings["1c_query_expansion_ms"]
                            )
                        except Exception as log_err:
                            logger.warning(f"Failed to log query expansion metrics: {log_err}")
                except Exception as e:
                    logger.warning(f"Query expansion failed, using original: {e}")
                    # Continue with original query

            # MULTI-USER SAFE: No global state mutations
            # - Uses thread-safe _get_cached_nodes
            # - Creates per-request retriever
            # - Uses global Settings.llm (stateless completion, no chat history)

            # Step 2: Get cached nodes for this notebook (thread-safe)
            t2 = time.time()
            nodes = pipeline._get_cached_nodes(notebook_id)
            timings["2_node_cache_ms"] = int((time.time() - t2) * 1000)
            logger.debug(f"Got {len(nodes)} cached nodes for notebook {notebook_id}")

            # Build sources from retrieval
            sources = []
            retrieval_results = []
            retrieval_strategy = "hybrid"

            if nodes:
                try:
                    # Verify engine is initialized (set during app startup)
                    if not pipeline._engine or not pipeline._engine._retriever:
                        return service_unavailable("Pipeline not initialized. Please try again.")

                    # Step 3: Create hybrid retriever (same as UI /chat)
                    # Uses BM25 + Vector + Rerank for precise chunk retrieval
                    # RAPTOR summaries are added separately in Step 6.5 as supplemental context
                    t3 = time.time()
                    retriever = pipeline._engine._retriever.get_retrievers(
                        llm=llm,
                        language="eng",
                        nodes=nodes,
                        offering_filter=[notebook_id],
                        vector_store=pipeline._vector_store,
                        notebook_id=notebook_id
                    )
                    timings["3_create_retriever_ms"] = int((time.time() - t3) * 1000)

                    # Step 4: Retrieve relevant chunks (using expanded query for follow-ups)
                    t4 = time.time()
                    query_bundle = QueryBundle(query_str=retrieval_query)
                    retrieval_results = retriever.retrieve(query_bundle)
                    timings["4_chunk_retrieval_ms"] = int((time.time() - t4) * 1000)

                    # Step 5: Format sources for response
                    t5 = time.time()
                    if include_sources:
                        for node_with_score in retrieval_results[:max_sources]:
                            node = node_with_score.node
                            metadata = node.metadata or {}
                            sources.append({
                                "filename": metadata.get("file_name", "Unknown"),
                                "snippet": node.text[:200] + "..." if len(node.text) > 200 else node.text,
                                "score": float(round(node_with_score.score or 0.0, 3))
                            })
                    timings["5_format_sources_ms"] = int((time.time() - t5) * 1000)

                    retrieval_strategy = retriever.__class__.__name__.replace("Retriever", "").lower()

                except Exception as e:
                    import traceback
                    logger.warning(f"Source retrieval failed: {e}")
                    logger.warning(f"Full traceback:\n{traceback.format_exc()}")
                    # Continue without sources

            # Step 6.5: RAPTOR cluster summaries (bounded, O(log n))
            # Adds high-level context without breaking existing flow
            # Can be skipped for precision queries that need exact numerical values
            t6 = time.time()
            raptor_summaries = []
            if not skip_raptor and pipeline._vector_store and hasattr(pipeline._vector_store, 'get_top_raptor_summaries'):
                try:
                    # Get query embedding for similarity search
                    t6a = time.time()
                    query_embedding = Settings.embed_model.get_query_embedding(retrieval_query)
                    timings["6a_raptor_embedding_ms"] = int((time.time() - t6a) * 1000)

                    # Bounded lookup: max 5 summaries, tree_level >= 1
                    t6b = time.time()
                    raptor_results = pipeline._vector_store.get_top_raptor_summaries(
                        notebook_id=notebook_id,
                        query_embedding=query_embedding,
                        top_k=5
                    )
                    timings["6b_raptor_lookup_ms"] = int((time.time() - t6b) * 1000)

                    raptor_summaries = [
                        (node, score) for node, score in raptor_results
                        if score >= 0.3  # Relevance threshold
                    ]
                    if raptor_summaries:
                        logger.info(f"Retrieved {len(raptor_summaries)} RAPTOR summaries for query")
                except Exception as e:
                    logger.debug(f"RAPTOR summaries unavailable: {e}")
                    # Continue without summaries - graceful degradation
            timings["6_raptor_total_ms"] = int((time.time() - t6) * 1000)

            # Step 7: Build hierarchical context
            t7 = time.time()
            # STATELESS LLM CALL: No shared chat history, no engine state
            # Build hierarchical context: RAPTOR summaries (framing) + chunks (evidence)
            context_parts = []

            # Add RAPTOR summaries first (high-level framing)
            if raptor_summaries:
                summary_texts = []
                for node, score in raptor_summaries[:3]:  # Max 3 summaries for context
                    summary_texts.append(node.text)
                if summary_texts:
                    context_parts.append("## HIGH-LEVEL CONTEXT (Document Summaries)\n" + "\n\n".join(summary_texts))

            # Add retrieved chunks (detailed evidence)
            chunk_texts = []
            for node_with_score in retrieval_results[:max_sources]:
                node = node_with_score.node
                metadata = node.metadata or {}
                doc_name = metadata.get("file_name", "Unknown")
                chunk_texts.append(f"[Source: {doc_name}]\n{node.text}")

            if chunk_texts:
                context_parts.append("## DETAILED EVIDENCE (Relevant Passages)\n" + "\n\n---\n\n".join(chunk_texts))

            context = "\n\n".join(context_parts) if context_parts else "No relevant context found."
            timings["7_context_building_ms"] = int((time.time() - t7) * 1000)

            # Step 8: Generate response using global LLM (stateless, thread-safe)
            # Use the same rich system prompt as UI /chat for intelligent responses
            t8 = time.time()
            from dbnotebook.core.prompt import get_system_prompt, get_context_prompt

            system_prompt = get_system_prompt("eng", is_rag_prompt=True)
            context_prompt_template = get_context_prompt("eng")
            context_prompt = context_prompt_template.format(context_str=context)

            # Build conversation history section (only if use_memory and has history)
            history_section = ""
            if use_memory and history_messages:
                history_parts = []
                for msg in history_messages[-max_history * 2:]:  # Last N exchanges
                    role_label = "User" if msg["role"] == "user" else "Assistant"
                    history_parts.append(f"{role_label}: {msg['content']}")
                history_section = "\n\n## CONVERSATION HISTORY\n" + "\n\n".join(history_parts)

            # Get API-specific format instructions (if requested)
            format_instructions = get_api_format_instructions(response_format)

            prompt = f"""{system_prompt}

{context_prompt}
{history_section}{format_instructions}

User question: {query}"""

            response = llm.complete(prompt)
            response_text = response.text
            timings["8_llm_completion_ms"] = int((time.time() - t8) * 1000)

            # Step 8b: Log query to QueryLogger for metrics
            if pipeline._query_logger:
                try:
                    from dbnotebook.core.observability.token_counter import get_token_counter
                    token_counter = get_token_counter()
                    prompt_tokens = token_counter.count_tokens(prompt)
                    completion_tokens = token_counter.count_tokens(response_text)
                    used_model = llm.model if hasattr(llm, 'model') else (model_name or 'unknown')

                    pipeline._query_logger.log_query(
                        notebook_id=notebook_id,
                        user_id=user_id,
                        query_text=query,
                        model_name=used_model,
                        prompt_tokens=prompt_tokens,
                        completion_tokens=completion_tokens,
                        response_time_ms=timings["8_llm_completion_ms"]
                    )
                except Exception as log_err:
                    logger.warning(f"Failed to log query metrics: {log_err}")

            # Step 9: Save conversation to in-memory session store (ephemeral)
            # Query API does NOT persist to DB - keeps RAG Chat history isolated
            if use_memory and session_id:
                t9 = time.time()
                session_key = str(session_id)
                if session_key not in _query_sessions:
                    _query_sessions[session_key] = []
                _query_sessions[session_key].append({"role": "user", "content": query})
                _query_sessions[session_key].append({"role": "assistant", "content": response_text})
                timings["9_save_history_ms"] = int((time.time() - t9) * 1000)

            execution_time_ms = int((time.time() - start_time) * 1000)

            logger.info(f"API query completed in {execution_time_ms}ms, session={session_id}, history_used={len(history_messages)}")

            # Build response - only include session_id if memory is enabled
            # Get current reranker config for response metadata
            from dbnotebook.core.providers.reranker_provider import get_reranker_config
            current_reranker_config = get_reranker_config()

            response_data = {
                "success": True,
                "response": response_text,
                "sources": sources,
                "metadata": {
                    "execution_time_ms": execution_time_ms,
                    "model": llm.model if hasattr(llm, 'model') else (pipeline._default_model.model if pipeline._default_model else "unknown"),
                    "retrieval_strategy": retrieval_strategy,
                    "node_count": len(nodes),
                    "stateless": not use_memory,
                    "history_messages_used": len(history_messages),
                    "raptor_summaries_used": len(raptor_summaries) if raptor_summaries else 0,
                    "skip_raptor": skip_raptor,
                    "reranker_enabled": current_reranker_config.get("enabled", True),
                    "reranker_model": current_reranker_config.get("model"),
                    "top_k": current_reranker_config.get("top_n"),
                    "response_format": response_format,
                    "timings": timings
                }
            }

            # Only return session_id if client sent one (memory enabled)
            if use_memory and session_id:
                response_data["session_id"] = str(session_id)

            return jsonify(response_data)

        except Exception as e:
            logger.error(f"Error in query endpoint: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return error_response(str(e), 500)
        finally:
            # Restore original reranker config if it was overridden
            if original_reranker_config is not None:
                from dbnotebook.core.providers.reranker_provider import set_reranker_config
                set_reranker_config(
                    model=original_reranker_config.get("model"),
                    enabled=original_reranker_config.get("enabled", True),
                    top_n=original_reranker_config.get("top_n")
                )
                logger.debug("Restored original reranker config")

    @app.route("/api/query/notebooks", methods=["GET"])
    @require_api_key
    def api_query_list_notebooks():
        """
        List available notebooks for querying.

        Response JSON:
            {
                "success": true,
                "notebooks": [
                    {
                        "id": "uuid",
                        "name": "My Notebook",
                        "document_count": 5,
                        "created_at": "2024-01-01T00:00:00Z"
                    }
                ]
            }
        """
        try:
            # Get user_id from query param or use default UUID for single-user deployments
            user_id = request.args.get("user_id", DEFAULT_USER_ID)
            notebooks = notebook_manager.list_notebooks(user_id)

            notebook_list = []
            for nb in notebooks:
                notebook_list.append({
                    "id": nb.get("id"),
                    "name": nb.get("name"),
                    "document_count": nb.get("document_count", 0),
                    "created_at": nb.get("created_at")
                })

            return success_response({"notebooks": notebook_list})

        except Exception as e:
            logger.error(f"Error listing notebooks: {e}")
            return error_response(str(e), 500)

    @app.route("/api/user/api-key", methods=["GET"])
    def api_get_user_api_key():
        """
        Get the API key for a user.

        Query params:
            user_id: UUID (optional, defaults to DEFAULT_USER_ID)

        Response JSON:
            {
                "success": true,
                "api_key": "user-api-key-string",
                "user_id": "uuid"
            }

        Note: This endpoint is intended for frontend use to display/copy
        the user's API key for programmatic access.
        """
        try:
            from dbnotebook.core.db.models import User as UserModel
            user_id = request.args.get("user_id", DEFAULT_USER_ID)

            with db_manager.get_session() as db_session:
                user = db_session.query(UserModel).filter(UserModel.user_id == user_id).first()

                if not user:
                    return not_found("User", user_id)

                return success_response({
                    "api_key": user.api_key,
                    "user_id": str(user.user_id)
                })

        except Exception as e:
            logger.error(f"Error getting user API key: {e}")
            return error_response(str(e), 500)

    return app
