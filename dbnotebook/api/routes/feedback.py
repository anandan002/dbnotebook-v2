"""Feedback API routes for collecting and querying RAG response quality signals.

Endpoints:
    POST /api/v2/chat/feedback                     — Submit thumbs/star feedback
    POST /api/v2/chat/feedback/<feedback_id>/nodes — Annotate retrieved nodes
    GET  /api/v2/feedback-stats                    — Aggregate stats (auth required)

All endpoints require an authenticated session (user_id present in Flask session).
"""

import logging
from flask import request, jsonify, session

from dbnotebook.api.core.response import (
    error_response,
    validation_error,
    not_found,
)
from dbnotebook.core.services.feedback_service import FeedbackService

logger = logging.getLogger(__name__)


def _get_session_user_id() -> str | None:
    """Return the authenticated user_id from the Flask session, or None."""
    return session.get("user_id")


def create_feedback_routes(app, pipeline, db_manager, notebook_manager):
    """Register feedback collection and statistics API routes.

    Args:
        app: Flask application instance.
        pipeline: LocalRAGPipeline instance.
        db_manager: DatabaseManager instance.
        notebook_manager: NotebookManager instance.
    """

    @app.route("/api/v2/chat/feedback", methods=["POST"])
    def submit_rag_feedback():
        """Submit user feedback on a chat response.

        Requires authenticated session (user must be logged in).

        Request JSON:
            {
                "trace_id": "string",        # Required — from metadata.trace_id
                "query_id": "string",        # Required — from metadata.query_id
                "notebook_id": "uuid",       # Required
                "rating": 4,                 # Optional: 1-5 star rating
                "helpful": true,             # Optional: thumbs up/down
                "user_message": "string",    # Optional: free-text explanation
                "feedback_category": "string" # Optional: inaccurate|irrelevant|incomplete|helpful|other
            }

        Response JSON (success):
            {
                "success": true,
                "feedback_id": "uuid"
            }

        Response JSON (error):
            {
                "success": false,
                "error": "description"
            }
        """
        # Auth guard — user must be logged in
        user_id = _get_session_user_id()
        if not user_id:
            return error_response("Authentication required", 401)

        try:
            data = request.json or {}

            trace_id = data.get("trace_id", "").strip()
            query_id = data.get("query_id", "").strip()
            notebook_id = data.get("notebook_id", "").strip()

            if not trace_id:
                return validation_error("trace_id is required")
            if not query_id:
                return validation_error("query_id is required")
            if not notebook_id:
                return validation_error("notebook_id is required")

            rating = data.get("rating")
            helpful = data.get("helpful")
            user_message = data.get("user_message")
            feedback_category = data.get("feedback_category")

            # Validate category if provided
            valid_categories = {"inaccurate", "irrelevant", "incomplete", "helpful", "other"}
            if feedback_category and feedback_category not in valid_categories:
                return validation_error(
                    f"feedback_category must be one of: {', '.join(sorted(valid_categories))}"
                )

            service = FeedbackService(pipeline, db_manager, notebook_manager)
            feedback_id = service.submit_feedback(
                trace_id=trace_id,
                query_id=query_id,
                user_id=user_id,
                notebook_id=notebook_id,
                rating=rating,
                helpful=helpful,
                user_message=user_message,
                feedback_category=feedback_category,
            )

            logger.info(
                f"Feedback submitted | feedback_id={feedback_id} | "
                f"user_id={user_id} | notebook_id={notebook_id}"
            )
            return jsonify({"success": True, "feedback_id": feedback_id})

        except ValueError as ve:
            return error_response(str(ve), 400)
        except RuntimeError as re:
            return error_response(str(re), 503)
        except Exception as exc:
            logger.error(f"Error submitting feedback: {exc}", exc_info=True)
            return error_response("Failed to submit feedback", 500)

    @app.route("/api/v2/chat/feedback/<feedback_id>/nodes", methods=["POST"])
    def annotate_feedback_nodes(feedback_id: str):
        """Attach per-node relevance annotations to an existing feedback record.

        Requires authenticated session.

        Path param:
            feedback_id: UUID of the rag_feedback row.

        Request JSON:
            {
                "nodes": [
                    {"node_id": "abc", "node_rank": 0, "was_relevant": true},
                    {"node_id": "def", "node_rank": 1, "was_relevant": false}
                ]
            }

        Response JSON (success):
            {"success": true, "annotated": 2}
        """
        user_id = _get_session_user_id()
        if not user_id:
            return error_response("Authentication required", 401)

        try:
            data = request.json or {}
            nodes = data.get("nodes", [])

            if not isinstance(nodes, list) or not nodes:
                return validation_error("nodes must be a non-empty list")

            service = FeedbackService(pipeline, db_manager, notebook_manager)
            service.annotate_nodes(feedback_id=feedback_id, nodes=nodes, requesting_user_id=user_id)

            return jsonify({"success": True, "annotated": len(nodes)})

        except PermissionError as pe:
            return error_response(str(pe), 403)
        except ValueError as ve:
            return error_response(str(ve), 400)
        except RuntimeError as re:
            return error_response(str(re), 503)
        except Exception as exc:
            logger.error(f"Error annotating feedback nodes: {exc}", exc_info=True)
            return error_response("Failed to annotate nodes", 500)

    @app.route("/api/v2/feedback-stats", methods=["GET"])
    def get_feedback_stats():
        """Get aggregated feedback statistics.

        Requires authenticated session.

        Query params:
            notebook_id: UUID filter (optional)
            days: Rolling window in days (optional, default: 7)

        Response JSON:
            {
                "success": true,
                "stats": {
                    "total_feedback": 42,
                    "avg_rating": 3.8,
                    "helpful_ratio": 0.714,
                    "rating_distribution": {"1": 2, "2": 3, "3": 8, "4": 18, "5": 11},
                    "category_breakdown": {"helpful": 15, "inaccurate": 5, ...},
                    "period_days": 7
                }
            }
        """
        user_id = _get_session_user_id()
        if not user_id:
            return error_response("Authentication required", 401)

        try:
            notebook_id = request.args.get("notebook_id") or None
            days_str = request.args.get("days", "7")
            try:
                days = max(1, min(int(days_str), 365))
            except (ValueError, TypeError):
                days = 7

            service = FeedbackService(pipeline, db_manager, notebook_manager)
            stats = service.get_feedback_stats(
                notebook_id=notebook_id,
                user_id=None,  # Admin view: all users; scope by user_id param later if needed
                days=days,
            )

            return jsonify({"success": True, "stats": stats})

        except RuntimeError as re:
            return error_response(str(re), 503)
        except Exception as exc:
            logger.error(f"Error fetching feedback stats: {exc}", exc_info=True)
            return error_response("Failed to fetch feedback stats", 500)

    return app
