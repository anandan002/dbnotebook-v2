"""Langfuse observability client for LLM tracing and evaluation.

Provides a singleton LangfuseTracer that wraps the Langfuse Python SDK
with graceful degradation — if Langfuse is disabled or unavailable, all
methods become no-ops and the main query flow is never disrupted.

Configuration (env vars):
    LANGFUSE_ENABLED     — "true" to enable (default: false)
    LANGFUSE_PUBLIC_KEY  — Public key from Langfuse project
    LANGFUSE_SECRET_KEY  — Secret key from Langfuse project
    LANGFUSE_HOST        — Langfuse host (default: https://cloud.langfuse.com)
"""

import logging
import os
import threading
import time
from typing import Any, Dict, Optional
from uuid import uuid4

logger = logging.getLogger(__name__)

# Module-level singleton with thread-safe lazy initialization
_tracer_instance: Optional["LangfuseTracer"] = None
_tracer_lock = threading.Lock()


class LangfuseTracer:
    """Thread-safe Langfuse tracing wrapper with graceful degradation.

    All public methods are wrapped in try/except so tracing failures
    NEVER propagate into the main RAG pipeline flow.

    The tracer uses the Langfuse low-level SDK to create traces, spans,
    and generation observations. Each public method returns a sensible
    default (empty string, None, or False) when Langfuse is disabled or
    an error occurs.

    Usage::

        tracer = get_tracer()
        trace_id = tracer.start_trace("rag_query", user_id=..., notebook_id=..., metadata={})
        tracer.log_span(trace_id, "retrieval", input_data=..., output_data=..., timing_ms=...)
        tracer.log_generation(trace_id, "llm_call", model=..., prompt=..., completion=..., ...)
        tracer.end_trace(trace_id, status="success")
        tracer.flush()
    """

    def __init__(self) -> None:
        """Initialize the tracer — lazily loads Langfuse SDK."""
        self._enabled: bool = False
        self._client = None  # Langfuse SDK instance
        self._traces: Dict[str, Any] = {}  # trace_id -> Langfuse trace object
        self._lock = threading.Lock()

        self._initialize()

    def _initialize(self) -> None:
        """Attempt to initialize Langfuse SDK from environment configuration."""
        enabled_str = os.getenv("LANGFUSE_ENABLED", "false").lower()
        if enabled_str not in ("true", "1", "yes"):
            logger.info("Langfuse tracing disabled (LANGFUSE_ENABLED not set to true)")
            return

        public_key = os.getenv("LANGFUSE_PUBLIC_KEY", "")
        secret_key = os.getenv("LANGFUSE_SECRET_KEY", "")
        host = os.getenv("LANGFUSE_HOST", "https://cloud.langfuse.com")

        if not public_key or not secret_key:
            logger.warning(
                "Langfuse enabled but LANGFUSE_PUBLIC_KEY or LANGFUSE_SECRET_KEY "
                "not set — tracing will be disabled"
            )
            return

        try:
            from langfuse import Langfuse  # type: ignore[import]

            self._client = Langfuse(
                public_key=public_key,
                secret_key=secret_key,
                host=host,
            )
            self._enabled = True
            logger.info(f"Langfuse tracing initialized | host={host}")
        except ImportError:
            logger.warning(
                "langfuse package not installed — tracing disabled. "
                "Install with: pip install langfuse>=2.0.0"
            )
        except Exception as exc:
            logger.warning(f"Langfuse initialization failed — tracing disabled: {exc}")

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def start_trace(
        self,
        name: str,
        user_id: Optional[str] = None,
        notebook_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> str:
        """Start a new Langfuse trace for a RAG query.

        Args:
            name: Trace name (e.g. "rag_query").
            user_id: User UUID for filtering in Langfuse dashboard.
            notebook_id: Notebook UUID stored in trace metadata.
            metadata: Additional metadata dict to attach to the trace.

        Returns:
            A trace_id string (UUID).  Returns a local UUID even when
            Langfuse is disabled so callers can use it for DB correlation.
        """
        trace_id = str(uuid4())
        if not self._enabled or self._client is None:
            return trace_id

        try:
            trace_metadata = {"notebook_id": notebook_id, **(metadata or {})}
            trace = self._client.trace(
                id=trace_id,
                name=name,
                user_id=str(user_id) if user_id else None,
                metadata=trace_metadata,
            )
            with self._lock:
                self._traces[trace_id] = trace
            logger.debug(f"Langfuse trace started: {trace_id}")
        except Exception as exc:
            logger.debug(f"Langfuse start_trace failed (non-fatal): {exc}")

        return trace_id

    def log_span(
        self,
        trace_id: str,
        name: str,
        input_data: Optional[Any] = None,
        output_data: Optional[Any] = None,
        metadata: Optional[Dict[str, Any]] = None,
        timing_ms: Optional[int] = None,
    ) -> None:
        """Log a named span under an existing trace.

        Args:
            trace_id: Trace identifier returned by start_trace().
            name: Span name (e.g. "retrieval", "reranking").
            input_data: Span input (will be JSON-serialized by Langfuse).
            output_data: Span output.
            metadata: Additional metadata.
            timing_ms: Duration in milliseconds (used to set end_time).
        """
        if not self._enabled or self._client is None:
            return

        try:
            with self._lock:
                trace = self._traces.get(trace_id)

            span_kwargs: Dict[str, Any] = {
                "name": name,
                "trace_id": trace_id,
                "metadata": metadata or {},
            }
            if input_data is not None:
                span_kwargs["input"] = input_data
            if output_data is not None:
                span_kwargs["output"] = output_data

            if trace is not None:
                span = trace.span(**span_kwargs)
            else:
                span = self._client.span(**span_kwargs)

            if timing_ms is not None:
                # Compute end_time from timing_ms so Langfuse shows duration
                end_time = time.time()
                start_offset = timing_ms / 1000.0
                span.update(
                    end_time=end_time,
                    start_time=end_time - start_offset,
                )
            span.end()
        except Exception as exc:
            logger.debug(f"Langfuse log_span failed (non-fatal): {exc}")

    def log_generation(
        self,
        trace_id: str,
        name: str,
        model: Optional[str] = None,
        prompt: Optional[str] = None,
        completion: Optional[str] = None,
        usage: Optional[Dict[str, int]] = None,
        timing_ms: Optional[int] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Log an LLM generation observation under a trace.

        Args:
            trace_id: Trace identifier.
            name: Generation name (e.g. "llm_call").
            model: Model name for cost tracking in Langfuse.
            prompt: Full prompt text sent to the LLM.
            completion: LLM response text.
            usage: Token usage dict with optional keys:
                   {"input": int, "output": int, "total": int}.
            timing_ms: Duration in milliseconds.
            metadata: Additional metadata.
        """
        if not self._enabled or self._client is None:
            return

        try:
            with self._lock:
                trace = self._traces.get(trace_id)

            gen_kwargs: Dict[str, Any] = {
                "name": name,
                "trace_id": trace_id,
                "metadata": metadata or {},
            }
            if model:
                gen_kwargs["model"] = model
            if prompt is not None:
                gen_kwargs["input"] = prompt
            if completion is not None:
                gen_kwargs["output"] = completion
            if usage:
                from langfuse.model import ModelUsage  # type: ignore[import]
                gen_kwargs["usage"] = ModelUsage(
                    input=usage.get("input", 0),
                    output=usage.get("output", 0),
                    total=usage.get("total"),
                )

            if trace is not None:
                generation = trace.generation(**gen_kwargs)
            else:
                generation = self._client.generation(**gen_kwargs)

            if timing_ms is not None:
                end_time = time.time()
                start_offset = timing_ms / 1000.0
                generation.update(
                    end_time=end_time,
                    start_time=end_time - start_offset,
                )
            generation.end()
        except Exception as exc:
            logger.debug(f"Langfuse log_generation failed (non-fatal): {exc}")

    def log_score(
        self,
        trace_id: str,
        name: str,
        value: float,
        comment: Optional[str] = None,
    ) -> None:
        """Attach a numeric score to a trace (e.g. user feedback rating).

        Args:
            trace_id: Trace identifier.
            name: Score name (e.g. "user_feedback", "relevance").
            value: Numeric score value (typically 0.0 – 1.0).
            comment: Optional human-readable comment.
        """
        if not self._enabled or self._client is None:
            return

        try:
            self._client.score(
                trace_id=trace_id,
                name=name,
                value=value,
                comment=comment,
                data_type="NUMERIC",
            )
        except Exception as exc:
            logger.debug(f"Langfuse log_score failed (non-fatal): {exc}")

    def end_trace(
        self,
        trace_id: str,
        status: str = "success",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Finalise a trace with status and optional metadata.

        Args:
            trace_id: Trace identifier.
            status: "success" | "error" | "partial".
            metadata: Any final metadata to attach.
        """
        if not self._enabled or self._client is None:
            return

        try:
            with self._lock:
                trace = self._traces.pop(trace_id, None)

            update_meta = {"status": status, **(metadata or {})}
            if trace is not None:
                trace.update(metadata=update_meta)
            else:
                # Trace may have been created externally; update by ID
                self._client.trace(id=trace_id, metadata=update_meta)
        except Exception as exc:
            logger.debug(f"Langfuse end_trace failed (non-fatal): {exc}")

    def flush(self) -> None:
        """Block until all pending Langfuse events have been delivered.

        Safe to call even when Langfuse is disabled.
        """
        if not self._enabled or self._client is None:
            return

        try:
            self._client.flush()
            logger.debug("Langfuse flush complete")
        except Exception as exc:
            logger.debug(f"Langfuse flush failed (non-fatal): {exc}")

    @property
    def is_enabled(self) -> bool:
        """True when Langfuse SDK is loaded and configured."""
        return self._enabled


def get_tracer() -> LangfuseTracer:
    """Return the module-level singleton LangfuseTracer.

    Thread-safe: initialisation happens at most once per process.

    Returns:
        The singleton LangfuseTracer instance.
    """
    global _tracer_instance
    if _tracer_instance is None:
        with _tracer_lock:
            if _tracer_instance is None:
                _tracer_instance = LangfuseTracer()
    return _tracer_instance
