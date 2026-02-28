"""V2 Chat API with stateless fast pattern and conversation memory.

This endpoint combines the speed of /api/query with conversation continuity.
Multi-user safe, thread-safe, supports 50-100 concurrent users.

Endpoint: POST /api/v2/chat
"""

import logging
import time
from uuid import uuid4
from flask import request, jsonify, Response

from llama_index.core import Settings

from dbnotebook.api.core.response import (
    error_response, validation_error, not_found, service_unavailable
)
from dbnotebook.core.stateless import (
    fast_retrieve,
    enhanced_retrieve,
    build_context_with_history,
    format_sources,
    execute_query,
    execute_query_streaming,
    load_conversation_history,
    save_conversation_turn,
    generate_session_id,
    expand_query_with_history_timed,
)
from dbnotebook.core.observability import get_tracer

logger = logging.getLogger(__name__)

# Note: V2 browser-facing endpoints don't require API key authentication.
# Use /api/query with X-API-Key header for programmatic API access.


def create_chat_v2_routes(app, pipeline, db_manager, notebook_manager, conversation_store):
    """Create V2 chat API routes with fast pattern and memory.

    Args:
        app: Flask application instance
        pipeline: LocalRAGPipeline instance
        db_manager: DatabaseManager instance
        notebook_manager: NotebookManager instance
        conversation_store: ConversationStore instance for memory
    """

    @app.route("/api/v2/chat", methods=["POST"])
    def api_v2_chat():
        """
        V2 Chat API with stateless fast pattern and conversation memory.

        Multi-user safe, thread-safe, uses the fast API pattern with
        database-backed conversation memory for continuity.

        Request JSON:
            {
                "notebook_id": "uuid",           # Required
                "query": "string",               # Required
                "user_id": "uuid",               # Required for multi-user
                "session_id": "uuid",            # Optional - for conversation continuity
                "include_history": true,         # Optional, default: true
                "max_history": 10,               # Optional, default: 10
                "include_sources": true,         # Optional, default: true
                "max_sources": 6                 # Optional, default: 6, max: 20
            }

        Response JSON:
            {
                "success": true,
                "response": "LLM response text",
                "session_id": "uuid",
                "sources": [...],
                "metadata": {
                    "execution_time_ms": 850,
                    "model": "gpt-4.1-nano",
                    "history_turns_used": 5,
                    "timings": {...}
                }
            }
        """
        start_time = time.time()
        timings = {}
        trace_id: str = ""
        query_id: str = str(uuid4())

        try:
            data = request.json or {}

            # Validate required fields
            notebook_id = data.get("notebook_id")
            query = data.get("query")
            user_id = data.get("user_id")

            if not notebook_id:
                return validation_error("notebook_id is required")

            if not query:
                return validation_error("query is required")

            if not user_id:
                return validation_error("user_id is required for multi-user chat")

            # Optional parameters
            model_name = data.get("model")
            session_id = data.get("session_id") or generate_session_id()
            include_history = data.get("include_history", True)
            max_history = min(data.get("max_history", 10), 50)
            include_sources = data.get("include_sources", True)
            max_sources = min(data.get("max_sources", 6), 20)

            # Retrieval settings (per-request tuning)
            use_reranker = data.get("use_reranker", True)
            reranker_model = data.get("reranker_model")  # xsmall, base, large
            use_raptor = data.get("use_raptor", True)
            top_k_explicit = data.get("top_k")
            top_k = top_k_explicit if top_k_explicit is not None else max_sources

            # Apply adaptive top_k only when caller has not set one explicitly.
            if top_k_explicit is None:
                try:
                    from dbnotebook.core.services.parameter_optimizer_service import ParameterOptimizerService
                    _opt = ParameterOptimizerService(
                        pipeline=pipeline, db_manager=db_manager, notebook_manager=notebook_manager
                    )
                    _adap = _opt.get_adaptive_settings(notebook_id=notebook_id)
                    if _adap and _adap.get("top_k"):
                        top_k = min(max(top_k, _adap["top_k"]), 20)
                        logger.info(f"Adaptive top_k={top_k} (feedback-driven default)")
                except Exception:
                    pass

            # Apply per-request reranker model if specified
            original_reranker_config = None
            if reranker_model:
                from dbnotebook.core.providers.reranker_provider import (
                    get_reranker_config, set_reranker_config
                )
                original_reranker_config = get_reranker_config()
                set_reranker_config(
                    model=reranker_model,
                    enabled=use_reranker,
                    top_n=top_k,
                )
                logger.debug(f"Per-request reranker: model={reranker_model}, enabled={use_reranker}")

            # Get LLM instance for this specific request
            from dbnotebook.core.model.model import LocalRAGModel
            local_llm = LocalRAGModel.set(model_name) if model_name else Settings.llm

            used_model = local_llm.model if hasattr(local_llm, 'model') else "unknown"
            logger.info(f"V2 chat: notebook_id={notebook_id}, user_id={user_id}, session_id={session_id}, model={used_model} (requested={model_name})")

            # Start Langfuse trace for this query
            try:
                tracer = get_tracer()
                trace_id = tracer.start_trace(
                    name="rag_query",
                    user_id=user_id,
                    notebook_id=notebook_id,
                    query=query,
                    metadata={"query_id": query_id, "model": used_model, "session_id": session_id},
                )
            except Exception as trace_err:
                logger.debug(f"Tracing start failed (non-fatal): {trace_err}")

            # Step 1: Verify notebook exists
            t1 = time.time()
            notebook = notebook_manager.get_notebook(notebook_id)
            timings["1_notebook_lookup_ms"] = int((time.time() - t1) * 1000)

            if not notebook:
                return not_found("Notebook", notebook_id)

            # Step 2: Load conversation history (from database)
            t2 = time.time()
            conversation_history = []
            if include_history:
                conversation_history = load_conversation_history(
                    conversation_store=conversation_store,
                    notebook_id=notebook_id,
                    user_id=user_id,
                    max_history=max_history,
                )
            timings["2a_load_history_ms"] = int((time.time() - t2) * 1000)

            # Step 2b: Expand follow-up queries using conversation history
            retrieval_query = query  # Default to original query
            if include_history and conversation_history:
                retrieval_query = expand_query_with_history_timed(
                    query=query,
                    conversation_history=conversation_history,
                    llm=local_llm,
                    timings=timings,
                    timing_key="2b_query_expansion_ms",
                )

            # Step 3: Get cached nodes (thread-safe)
            t3 = time.time()
            nodes = pipeline._get_cached_nodes(notebook_id)
            timings["3_node_cache_ms"] = int((time.time() - t3) * 1000)
            logger.debug(f"Got {len(nodes)} cached nodes for notebook {notebook_id}")

            # Apply adaptive retrieval parameters from feedback self-correction loop
            adaptive_sim_threshold = None
            try:
                from dbnotebook.core.services.parameter_optimizer_service import ParameterOptimizerService
                from dbnotebook.setting import QueryTimeSettings
                _optimizer = ParameterOptimizerService(
                    pipeline=pipeline, db_manager=db_manager, notebook_manager=notebook_manager
                )
                _adaptive = _optimizer.get_adaptive_settings(notebook_id=notebook_id)
                if _adaptive:
                    if "top_k" in _adaptive:
                        top_k = max(top_k, _adaptive["top_k"])
                        # Push new similarity_top_k into retriever so it fetches more pre-rerank
                        if pipeline._engine and pipeline._engine._retriever:
                            _retriever = pipeline._engine._retriever
                            _cur = _retriever._query_settings
                            _retriever.set_query_settings(QueryTimeSettings(
                                similarity_top_k=_adaptive["top_k"],
                                bm25_weight=_cur.bm25_weight if _cur else 0.5,
                                vector_weight=_cur.vector_weight if _cur else 0.5,
                                temperature=_cur.temperature if _cur else 0.1,
                            ))
                            _retriever._retriever_cache.clear()
                    if "similarity_threshold" in _adaptive:
                        adaptive_sim_threshold = _adaptive["similarity_threshold"]
                    logger.info(
                        f"Adaptive retrieval: top_k={top_k}, sim_threshold={adaptive_sim_threshold}"
                    )
            except Exception as _ae:
                logger.debug(f"Adaptive settings lookup failed (non-fatal): {_ae}")

            # Step 4: Enhanced retrieval with RAPTOR-aware reranking
            retrieval_results = []
            raptor_summaries = []
            retrieval_strategy = "hybrid"
            if nodes:
                try:
                    if not pipeline._engine or not pipeline._engine._retriever:
                        return service_unavailable("Pipeline not initialized. Please try again.")

                    t4 = time.time()
                    # Use enhanced_retrieve for unified RAPTOR + chunk retrieval with reranking
                    retrieval_results, raptor_summaries, retrieval_meta = enhanced_retrieve(
                        nodes=nodes,
                        query=retrieval_query,  # Use expanded query for retrieval
                        notebook_id=notebook_id,
                        vector_store=pipeline._vector_store,
                        retriever_factory=pipeline._engine._retriever,
                        llm=local_llm,
                        embed_model=Settings.embed_model,
                        top_k=top_k,
                        use_raptor=use_raptor,
                        use_reranker=use_reranker,
                    )
                    timings["4_enhanced_retrieval_ms"] = int((time.time() - t4) * 1000)
                    retrieval_strategy = retrieval_meta.get("strategy_used", "raptor_aware")

                    # Log retrieval span to Langfuse
                    try:
                        tracer = get_tracer()
                        tracer.log_span(
                            trace_id=trace_id,
                            name="enhanced_retrieval",
                            input_data={"query": retrieval_query, "top_k": top_k},
                            output_data={
                                "chunk_count": len(retrieval_results),
                                "raptor_count": len(raptor_summaries) if raptor_summaries else 0,
                                "strategy": retrieval_strategy,
                            },
                            timing_ms=timings["4_enhanced_retrieval_ms"],
                        )
                    except Exception as span_err:
                        logger.debug(f"Retrieval span logging failed (non-fatal): {span_err}")

                    # Add detailed timing breakdown if available
                    if "chunk_retrieval_ms" in retrieval_meta:
                        timings["4a_chunk_retrieval_ms"] = retrieval_meta["chunk_retrieval_ms"]
                    if "raptor_retrieval_ms" in retrieval_meta:
                        timings["4b_raptor_retrieval_ms"] = retrieval_meta["raptor_retrieval_ms"]
                    if "reranking_ms" in retrieval_meta:
                        timings["4c_reranking_ms"] = retrieval_meta["reranking_ms"]

                    # Apply adaptive similarity threshold (post-retrieval filter)
                    if adaptive_sim_threshold is not None and retrieval_results:
                        before = len(retrieval_results)
                        retrieval_results = [
                            n for n in retrieval_results
                            if n.score is None or n.score >= adaptive_sim_threshold
                        ]
                        logger.debug(
                            f"Adaptive threshold {adaptive_sim_threshold}: "
                            f"{before} → {len(retrieval_results)} chunks"
                        )

                except Exception as e:
                    logger.warning(f"Enhanced retrieval failed [{type(e).__name__}]: {e}", exc_info=True)
                    # Fallback to simple retrieval
                    try:
                        retrieval_results = fast_retrieve(
                            nodes=nodes,
                            query=retrieval_query,
                            notebook_id=notebook_id,
                            vector_store=pipeline._vector_store,
                            retriever_factory=pipeline._engine._retriever,
                            llm=local_llm,
                            top_k=max_sources,
                        )
                        retrieval_strategy = "hybrid_fallback"
                    except Exception as fallback_e:
                        logger.warning(f"Fallback retrieval also failed: {fallback_e}")

            # Step 6: Build context with history
            t6 = time.time()
            context = build_context_with_history(
                retrieval_results=retrieval_results,
                raptor_summaries=raptor_summaries,
                conversation_history=conversation_history,
                max_history=max_history,
                max_summaries=3,
                max_chunks=max_sources,
            )
            timings["6_context_building_ms"] = int((time.time() - t6) * 1000)

            # Step 7: Execute query (stateless LLM call)
            t7 = time.time()
            response_text = execute_query(
                query=query,
                context=context,
                llm=local_llm,
            )
            timings["7_llm_completion_ms"] = int((time.time() - t7) * 1000)

            # Log LLM generation to Langfuse
            try:
                tracer = get_tracer()
                from dbnotebook.core.observability.token_counter import get_token_counter as _gtc
                _tc = _gtc()
                _prompt_tok = _tc.count_tokens(query + context)
                _compl_tok = _tc.count_tokens(response_text)
                tracer.log_generation(
                    trace_id=trace_id,
                    name="llm_generation",
                    model=used_model,
                    prompt=query,
                    completion=response_text[:2000] if response_text else "",
                    usage={"input": _prompt_tok, "output": _compl_tok, "total": _prompt_tok + _compl_tok},
                    timing_ms=timings["7_llm_completion_ms"],
                )
            except Exception as gen_err:
                logger.debug(f"Generation logging failed (non-fatal): {gen_err}")

            # Step 7b: Log query to QueryLogger for metrics
            if pipeline._query_logger:
                try:
                    from dbnotebook.core.observability.token_counter import get_token_counter
                    token_counter = get_token_counter()
                    prompt_tokens = token_counter.count_tokens(query + context)
                    completion_tokens = token_counter.count_tokens(response_text)

                    pipeline._query_logger.log_query(
                        notebook_id=notebook_id,
                        user_id=user_id,
                        query_text=query,
                        model_name=used_model,
                        prompt_tokens=prompt_tokens,
                        completion_tokens=completion_tokens,
                        response_time_ms=timings["7_llm_completion_ms"]
                    )
                except Exception as log_err:
                    logger.warning(f"Failed to log query metrics: {log_err}")

            # Step 8: Save conversation turn to database
            t8 = time.time()
            save_conversation_turn(
                conversation_store=conversation_store,
                notebook_id=notebook_id,
                user_id=user_id,
                user_message=query,
                assistant_response=response_text,
            )
            timings["8_save_history_ms"] = int((time.time() - t8) * 1000)

            # Step 9: Format sources
            sources = []
            if include_sources:
                sources = format_sources(
                    retrieval_results=retrieval_results,
                    max_sources=max_sources,
                )

            execution_time_ms = int((time.time() - start_time) * 1000)

            logger.info(f"V2 chat completed in {execution_time_ms}ms, {len(sources)} sources, {len(conversation_history)} history turns")

            # End Langfuse trace successfully
            try:
                tracer = get_tracer()
                tracer.end_trace(trace_id, status="success", response=response_text, metadata={"execution_time_ms": execution_time_ms})
            except Exception as trace_end_err:
                logger.debug(f"Trace end failed (non-fatal): {trace_end_err}")

            return jsonify({
                "success": True,
                "response": response_text,
                "session_id": session_id,
                "sources": sources,
                "metadata": {
                    "execution_time_ms": execution_time_ms,
                    "model": local_llm.model if hasattr(local_llm, 'model') else (pipeline._default_model.model if pipeline._default_model else "unknown"),
                    "retrieval_strategy": retrieval_strategy,
                    "node_count": len(nodes),
                    "raptor_summaries_used": len(raptor_summaries) if raptor_summaries else 0,
                    "history_turns_used": len(conversation_history) // 2,
                    "timings": timings,
                    "trace_id": trace_id,
                    "query_id": query_id,
                }
            })

        except Exception as e:
            logger.error(f"Error in V2 chat endpoint: {e}")
            import traceback
            logger.error(traceback.format_exc())
            # End trace with error status on failure
            try:
                if trace_id:
                    tracer = get_tracer()
                    tracer.end_trace(trace_id, status="error", metadata={"error": str(e)})
            except Exception:
                pass
            return error_response(str(e), 500)

    @app.route("/api/v2/chat/stream", methods=["POST"])
    def api_v2_chat_stream():
        """
        V2 Chat API with streaming response.

        Same as /api/v2/chat but returns Server-Sent Events (SSE) stream.
        """
        try:
            data = request.json or {}

            # Validate required fields
            notebook_id = data.get("notebook_id")
            query = data.get("query")
            user_id = data.get("user_id")

            if not notebook_id or not query or not user_id:
                return validation_error("notebook_id, query, and user_id are required")

            # Optional parameters
            model_name = data.get("model")
            session_id = data.get("session_id") or generate_session_id()
            include_history = data.get("include_history", True)
            max_history = min(data.get("max_history", 10), 50)
            max_sources = min(data.get("max_sources", 6), 20)

            # Retrieval settings (per-request tuning)
            use_reranker = data.get("use_reranker", True)
            reranker_model = data.get("reranker_model")  # xsmall, base, large
            use_raptor = data.get("use_raptor", True)
            top_k_explicit = data.get("top_k")
            top_k = top_k_explicit if top_k_explicit is not None else max_sources

            # Apply per-request reranker model if specified
            original_reranker_config = None
            if reranker_model:
                from dbnotebook.core.providers.reranker_provider import (
                    get_reranker_config, set_reranker_config
                )
                original_reranker_config = get_reranker_config()
                set_reranker_config(
                    model=reranker_model,
                    enabled=use_reranker,
                    top_n=top_k,
                )
                logger.debug(f"Per-request reranker (stream): model={reranker_model}, enabled={use_reranker}")

            # Get LLM instance for this specific request
            from dbnotebook.core.model.model import LocalRAGModel
            local_llm = LocalRAGModel.set(model_name) if model_name else Settings.llm

            used_model = local_llm.model if hasattr(local_llm, 'model') else "unknown"
            logger.info(f"V2 chat stream: notebook_id={notebook_id}, model={used_model} (requested={model_name})")

            # Verify notebook
            notebook = notebook_manager.get_notebook(notebook_id)
            if not notebook:
                return not_found("Notebook", notebook_id)

            # Start trace for this streaming request
            stream_trace_id = ""
            stream_query_id = str(uuid4())
            try:
                tracer = get_tracer()
                stream_trace_id = tracer.start_trace(
                    name="rag_query_stream",
                    user_id=user_id,
                    notebook_id=notebook_id,
                    query=query,
                    metadata={"query_id": stream_query_id, "model": used_model, "session_id": session_id},
                )
            except Exception as strace_err:
                logger.debug(f"Stream trace start failed (non-fatal): {strace_err}")

            def generate():
                import json
                import time as time_module
                response_text = ""
                start_time = time_module.time()
                timings = {}

                try:
                    # Load history
                    t1 = time_module.time()
                    conversation_history = []
                    if include_history:
                        conversation_history = load_conversation_history(
                            conversation_store=conversation_store,
                            notebook_id=notebook_id,
                            user_id=user_id,
                            max_history=max_history,
                        )
                    timings["1a_load_history_ms"] = int((time_module.time() - t1) * 1000)

                    # Query expansion for follow-up queries
                    retrieval_query = query  # Default to original query
                    if include_history and conversation_history:
                        retrieval_query = expand_query_with_history_timed(
                            query=query,
                            conversation_history=conversation_history,
                            llm=local_llm,
                            timings=timings,
                            timing_key="1b_query_expansion_ms",
                        )

                    # Get nodes and retrieve
                    t2 = time_module.time()
                    nodes = pipeline._get_cached_nodes(notebook_id)
                    timings["2_node_cache_ms"] = int((time_module.time() - t2) * 1000)

                    # Apply adaptive similarity_top_k — DB query only on notebook switch
                    if top_k_explicit is None and nodes and pipeline._engine and pipeline._engine._retriever:
                        _r = pipeline._engine._retriever
                        _last_nb = getattr(_r, "_adaptive_notebook_id", None)
                        if _last_nb != notebook_id:
                            try:
                                from dbnotebook.core.services.parameter_optimizer_service import ParameterOptimizerService
                                _opt = ParameterOptimizerService(
                                    pipeline=pipeline, db_manager=db_manager, notebook_manager=notebook_manager
                                )
                                _adap = _opt.get_adaptive_settings(notebook_id=notebook_id)
                                new_top_k = min(_adap["top_k"], 20) if _adap and _adap.get("top_k") else max_sources
                            except Exception as e:
                                logger.debug(f"Adaptive settings lookup failed (non-fatal): {e}")
                                new_top_k = max_sources
                            if new_top_k != getattr(_r, "_adaptive_top_k", max_sources):
                                if _r._query_settings:
                                    _r._query_settings.similarity_top_k = new_top_k
                                _r._setting.retriever.top_k_rerank = new_top_k
                                _r._retriever_cache.clear()
                                logger.info(f"similarity_top_k={new_top_k}, top_k_rerank={new_top_k} applied for notebook {notebook_id}")
                            _r._adaptive_notebook_id = notebook_id
                            _r._adaptive_top_k = new_top_k
                            top_k = new_top_k
                        else:
                            top_k = getattr(_r, "_adaptive_top_k", max_sources)

                    retrieval_results = []
                    raptor_summaries = []
                    retrieval_strategy = "hybrid"
                    if nodes and pipeline._engine and pipeline._engine._retriever:
                        t3 = time_module.time()
                        try:
                            # Use enhanced_retrieve for unified RAPTOR + chunk retrieval
                            retrieval_results, raptor_summaries, retrieval_meta = enhanced_retrieve(
                                nodes=nodes,
                                query=retrieval_query,
                                notebook_id=notebook_id,
                                vector_store=pipeline._vector_store,
                                retriever_factory=pipeline._engine._retriever,
                                llm=local_llm,
                                embed_model=Settings.embed_model,
                                top_k=top_k,
                                use_raptor=use_raptor,
                                use_reranker=use_reranker,
                            )
                            retrieval_strategy = retrieval_meta.get("strategy_used", "raptor_aware")
                        except Exception as e:
                            logger.warning(f"Enhanced retrieval failed in stream: {e}")
                            # Fallback to simple retrieval
                            retrieval_results = fast_retrieve(
                                nodes=nodes,
                                query=retrieval_query,
                                notebook_id=notebook_id,
                                vector_store=pipeline._vector_store,
                                retriever_factory=pipeline._engine._retriever,
                                llm=local_llm,
                                top_k=max_sources,
                            )
                            retrieval_strategy = "hybrid_fallback"
                        timings["3_retrieval_ms"] = int((time_module.time() - t3) * 1000)

                    # Build context
                    t5 = time_module.time()
                    context = build_context_with_history(
                        retrieval_results=retrieval_results,
                        raptor_summaries=raptor_summaries,
                        conversation_history=conversation_history,
                        max_history=max_history,
                    )
                    timings["5_context_ms"] = int((time_module.time() - t5) * 1000)

                    # Send sources first
                    sources = format_sources(retrieval_results, max_sources)
                    yield f"data: {json.dumps({'type': 'sources', 'sources': sources})}\n\n"

                    # Stream response
                    t6 = time_module.time()
                    for chunk in execute_query_streaming(query, context, local_llm):
                        response_text += chunk
                        yield f"data: {json.dumps({'type': 'content', 'content': chunk})}\n\n"
                    timings["6_llm_stream_ms"] = int((time_module.time() - t6) * 1000)

                    # Save conversation after streaming completes
                    t7 = time_module.time()
                    save_conversation_turn(
                        conversation_store=conversation_store,
                        notebook_id=notebook_id,
                        user_id=user_id,
                        user_message=query,
                        assistant_response=response_text,
                    )
                    timings["7_save_history_ms"] = int((time_module.time() - t7) * 1000)

                    # Log query to QueryLogger for metrics
                    if pipeline._query_logger:
                        try:
                            from dbnotebook.core.observability.token_counter import get_token_counter
                            token_counter = get_token_counter()
                            prompt_tokens = token_counter.count_tokens(query + context)
                            completion_tokens = token_counter.count_tokens(response_text)

                            pipeline._query_logger.log_query(
                                notebook_id=notebook_id,
                                user_id=user_id,
                                query_text=query,
                                model_name=used_model,
                                prompt_tokens=prompt_tokens,
                                completion_tokens=completion_tokens,
                                response_time_ms=timings["6_llm_stream_ms"]
                            )
                        except Exception as log_err:
                            logger.warning(f"Failed to log query metrics: {log_err}")

                    # Calculate total execution time
                    execution_time_ms = int((time_module.time() - start_time) * 1000)

                    # End Langfuse trace — pass response text so it shows in UI output
                    try:
                        _tracer = get_tracer()
                        _tracer.end_trace(
                            stream_trace_id,
                            status="success",
                            response=response_text,
                            metadata={"execution_time_ms": execution_time_ms},
                        )
                    except Exception:
                        pass

                    # Build metadata
                    metadata = {
                        "execution_time_ms": execution_time_ms,
                        "model": local_llm.model if hasattr(local_llm, 'model') else (pipeline._default_model.model if pipeline._default_model else "unknown"),
                        "retrieval_strategy": retrieval_strategy,
                        "node_count": len(nodes) if nodes else 0,
                        "raptor_summaries_used": len(raptor_summaries) if raptor_summaries else 0,
                        "history_turns_used": len(conversation_history) // 2,
                        "timings": timings,
                        "trace_id": stream_trace_id,
                        "query_id": stream_query_id,
                    }

                    # Send completion signal with metadata
                    yield f"data: {json.dumps({'type': 'done', 'session_id': session_id, 'metadata': metadata})}\n\n"

                except Exception as e:
                    logger.error(f"Streaming error: {e}")
                    try:
                        if stream_trace_id:
                            get_tracer().end_trace(stream_trace_id, status="error", metadata={"error": str(e)})
                    except Exception:
                        pass
                    yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"
                finally:
                    # Restore original reranker config if it was overridden
                    if original_reranker_config is not None:
                        from dbnotebook.core.providers.reranker_provider import set_reranker_config
                        set_reranker_config(
                            model=original_reranker_config.get("model"),
                            enabled=original_reranker_config.get("enabled", True),
                            top_n=original_reranker_config.get("top_n"),
                        )

            return Response(
                generate(),
                mimetype='text/event-stream',
                headers={
                    'Cache-Control': 'no-cache',
                    'X-Accel-Buffering': 'no',
                }
            )

        except Exception as e:
            logger.error(f"Error in V2 chat stream endpoint: {e}")
            return jsonify({
                "success": False,
                "error": str(e)
            }), 500

    @app.route("/api/v2/chat/history", methods=["GET"])
    def api_v2_chat_history():
        """
        Get conversation history for a notebook.

        Query params:
            notebook_id: UUID (required)
            user_id: UUID (required)
            limit: int (optional, default: 50)
        """
        try:
            notebook_id = request.args.get("notebook_id")
            user_id = request.args.get("user_id")
            limit = min(int(request.args.get("limit", 50)), 200)

            if not notebook_id or not user_id:
                return jsonify({
                    "success": False,
                    "error": "notebook_id and user_id are required"
                }), 400

            history = load_conversation_history(
                conversation_store=conversation_store,
                notebook_id=notebook_id,
                user_id=user_id,
                max_history=limit,
            )

            return jsonify({
                "success": True,
                "history": history,
                "count": len(history),
            })

        except Exception as e:
            logger.error(f"Error getting chat history: {e}")
            return jsonify({
                "success": False,
                "error": str(e)
            }), 500

    @app.route("/api/v2/chat/history", methods=["DELETE"])
    def api_v2_clear_chat_history():
        """
        Clear conversation history for a notebook.

        Request JSON:
            {
                "notebook_id": "uuid",
                "user_id": "uuid"
            }
        """
        try:
            data = request.json or {}
            notebook_id = data.get("notebook_id")
            user_id = data.get("user_id")

            if not notebook_id:
                return jsonify({
                    "success": False,
                    "error": "notebook_id is required"
                }), 400

            # Clear notebook history (for this user or all if user_id not provided)
            cleared = conversation_store.clear_notebook_history(notebook_id)

            return jsonify({
                "success": True,
                "cleared": cleared,
            })

        except Exception as e:
            logger.error(f"Error clearing chat history: {e}")
            return jsonify({
                "success": False,
                "error": str(e)
            }), 500

    return app
