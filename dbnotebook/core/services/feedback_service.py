"""Feedback service for collecting and aggregating RAG response quality signals.

User feedback (thumbs up/down, star ratings, category tags) is stored in the
rag_feedback table and optionally forwarded to Langfuse as trace scores so that
quality degradation is visible in the observability dashboard.
"""

import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional
from uuid import uuid4

from .base import BaseService

logger = logging.getLogger(__name__)


class FeedbackService(BaseService):
    """Service for collecting user feedback on RAG chat responses.

    Stores feedback in the database and optionally forwards scores to Langfuse.
    Follows the BaseService pattern: receives pipeline, db_manager, notebook_manager
    via constructor injection.
    """

    def submit_feedback(
        self,
        trace_id: str,
        query_id: str,
        user_id: str,
        notebook_id: str,
        rating: Optional[int] = None,
        helpful: Optional[bool] = None,
        user_message: Optional[str] = None,
        feedback_category: Optional[str] = None,
    ) -> str:
        """Store feedback in the database and forward score to Langfuse.

        Args:
            trace_id: Langfuse trace ID returned by the chat endpoint.
            query_id: Internal query UUID returned by the chat endpoint.
            user_id: UUID of the user submitting feedback.
            notebook_id: UUID of the notebook the query was made against.
            rating: Optional star rating 1–5.
            helpful: Optional boolean thumbs up/down signal.
            user_message: Optional free-text explanation.
            feedback_category: One of: inaccurate | irrelevant | incomplete | helpful | other.

        Returns:
            str: UUID of the created rag_feedback row.

        Raises:
            ValueError: If rating is out of range or a duplicate trace_id exists.
            RuntimeError: If the database is not configured.
        """
        self._validate_database_available()

        # Validate rating
        if rating is not None and not (1 <= rating <= 5):
            raise ValueError(f"rating must be between 1 and 5, got {rating}")

        # Validate that at least one signal is provided
        if rating is None and helpful is None:
            raise ValueError("At least one of 'rating' or 'helpful' must be provided")

        from dbnotebook.core.db.models import RAGFeedback

        with self._db_manager.get_session() as session:  # type: ignore[union-attr]
            # Duplicate guard — one feedback record per trace
            existing = (
                session.query(RAGFeedback)
                .filter(RAGFeedback.trace_id == trace_id)
                .first()
            )
            if existing is not None:
                raise ValueError(
                    f"Feedback for trace_id='{trace_id}' already exists "
                    f"(feedback_id={existing.feedback_id})"
                )

            feedback_id = uuid4()
            record = RAGFeedback(
                feedback_id=feedback_id,
                trace_id=trace_id,
                query_id=query_id,
                user_id=user_id,
                notebook_id=notebook_id,
                rating=rating,
                helpful=helpful,
                user_message=user_message[:2000] if user_message else None,
                feedback_category=feedback_category,
                created_at=datetime.utcnow(),
            )
            session.add(record)

        self._logger.info(
            f"Feedback stored | feedback_id={feedback_id} | trace_id={trace_id} | "
            f"rating={rating} | helpful={helpful} | category={feedback_category}"
        )

        # Forward numeric score to Langfuse (non-blocking, fire-and-forget)
        if rating is not None and trace_id:
            try:
                from dbnotebook.core.observability import get_tracer
                tracer = get_tracer()
                normalized = (rating - 1) / 4.0  # Map 1-5 → 0.0-1.0
                tracer.log_score(
                    trace_id=trace_id,
                    name="user_rating",
                    value=normalized,
                    comment=f"Star rating: {rating}/5{' — ' + user_message[:100] if user_message else ''}",
                )
            except Exception as score_err:
                logger.debug(f"Langfuse score logging failed (non-fatal): {score_err}")

        if helpful is not None and trace_id:
            try:
                from dbnotebook.core.observability import get_tracer
                tracer = get_tracer()
                tracer.log_score(
                    trace_id=trace_id,
                    name="user_helpful",
                    value=1.0 if helpful else 0.0,
                    comment=f"Helpful: {helpful}",
                )
            except Exception as score_err:
                logger.debug(f"Langfuse helpful score logging failed (non-fatal): {score_err}")

        return str(feedback_id)

    def annotate_nodes(
        self,
        feedback_id: str,
        nodes: List[Dict],
    ) -> bool:
        """Attach per-node relevance annotations to an existing feedback record.

        Args:
            feedback_id: UUID of the rag_feedback row to annotate.
            nodes: List of node dicts with keys:
                   - node_id (str, required)
                   - node_rank (int, optional)
                   - was_relevant (bool, optional)

        Returns:
            True on success.

        Raises:
            ValueError: If the feedback_id does not exist.
            RuntimeError: If the database is not configured.
        """
        self._validate_database_available()

        from dbnotebook.core.db.models import RAGFeedback, RAGFeedbackNode

        with self._db_manager.get_session() as session:  # type: ignore[union-attr]
            feedback = (
                session.query(RAGFeedback)
                .filter(RAGFeedback.feedback_id == feedback_id)
                .first()
            )
            if feedback is None:
                raise ValueError(f"feedback_id='{feedback_id}' not found")

            for node_data in nodes:
                node_id = node_data.get("node_id")
                if not node_id:
                    continue
                annotation = RAGFeedbackNode(
                    feedback_id=feedback_id,
                    node_id=str(node_id),
                    node_rank=node_data.get("node_rank"),
                    was_relevant=node_data.get("was_relevant"),
                )
                session.add(annotation)

        self._logger.info(
            f"Node annotations stored | feedback_id={feedback_id} | count={len(nodes)}"
        )
        return True

    def get_feedback_stats(
        self,
        notebook_id: Optional[str] = None,
        user_id: Optional[str] = None,
        days: int = 7,
    ) -> Dict:
        """Aggregate feedback statistics over a rolling time window.

        Args:
            notebook_id: Optional filter to a specific notebook.
            user_id: Optional filter to a specific user.
            days: Rolling window in days (default: 7).

        Returns:
            Dict with keys:
            - total_feedback: int
            - avg_rating: float | None
            - helpful_ratio: float | None  (fraction of helpful=True responses)
            - rating_distribution: {1: int, 2: int, ..., 5: int}
            - category_breakdown: {category: int}
            - period_days: int
        """
        self._validate_database_available()

        from dbnotebook.core.db.models import RAGFeedback
        from sqlalchemy import func

        cutoff = datetime.utcnow() - timedelta(days=days)

        with self._db_manager.get_session() as session:  # type: ignore[union-attr]
            q = session.query(RAGFeedback).filter(RAGFeedback.created_at >= cutoff)
            if notebook_id:
                q = q.filter(RAGFeedback.notebook_id == notebook_id)
            if user_id:
                q = q.filter(RAGFeedback.user_id == user_id)

            records = q.all()

        total = len(records)
        if total == 0:
            return {
                "total_feedback": 0,
                "avg_rating": None,
                "helpful_ratio": None,
                "rating_distribution": {1: 0, 2: 0, 3: 0, 4: 0, 5: 0},
                "category_breakdown": {},
                "period_days": days,
            }

        ratings = [r.rating for r in records if r.rating is not None]
        helpfuls = [r.helpful for r in records if r.helpful is not None]

        avg_rating: Optional[float] = (
            round(sum(ratings) / len(ratings), 2) if ratings else None
        )
        helpful_ratio: Optional[float] = (
            round(sum(1 for h in helpfuls if h) / len(helpfuls), 3) if helpfuls else None
        )

        distribution: Dict[int, int] = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}
        for r in ratings:
            if 1 <= r <= 5:
                distribution[r] += 1

        category_breakdown: Dict[str, int] = {}
        for record in records:
            cat = record.feedback_category or "unspecified"
            category_breakdown[cat] = category_breakdown.get(cat, 0) + 1

        return {
            "total_feedback": total,
            "avg_rating": avg_rating,
            "helpful_ratio": helpful_ratio,
            "rating_distribution": distribution,
            "category_breakdown": category_breakdown,
            "period_days": days,
        }
