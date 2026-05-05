"""Settings API routes for runtime configuration.

Provides endpoints to configure system settings at runtime without restart:
- Reranker model selection and enable/disable
- Model selection (LLM)
- Other configurable parameters

Supports model aliases, local paths, and HuggingFace IDs:
- Aliases: "base", "large", "xsmall", "disabled"
- Local: "models/rerankers/mxbai-rerank-base-v1"
- HuggingFace: "mixedbread-ai/mxbai-rerank-base-v1"
"""

import logging
from flask import request, jsonify

from ...core.providers.reranker_provider import (
    get_reranker_config,
    set_reranker_config,
    is_reranker_enabled,
    list_available_models,
    resolve_model_path,
)

logger = logging.getLogger(__name__)


def create_settings_routes(app):
    """Create Settings API routes.

    Args:
        app: Flask application instance
    """

    @app.route("/api/settings/reranker", methods=["GET"])
    def get_reranker_settings():
        """
        Get current reranker configuration.

        Response JSON:
            {
                "success": true,
                "config": {
                    "enabled": true,
                    "model": "base",
                    "resolved_model": "models/rerankers/mxbai-rerank-base-v1",
                    "top_n": 10,
                    "loaded": true,
                    "is_local": true
                },
                "available_models": [
                    {
                        "id": "base",
                        "name": "MxBai Base v1",
                        "is_local": true,
                        "path": "models/rerankers/mxbai-rerank-base-v1",
                        ...
                    }
                ]
            }
        """
        try:
            config = get_reranker_config()
            available = list_available_models()
            return jsonify({
                "success": True,
                "config": config,
                "available_models": available
            })
        except Exception as e:
            logger.error(f"Error getting reranker config: {e}")
            return jsonify({
                "success": False,
                "error": str(e)
            }), 500

    @app.route("/api/settings/reranker", methods=["POST"])
    def update_reranker_settings():
        """
        Update reranker configuration at runtime.

        Supports model aliases, local paths, and HuggingFace IDs:
        - Aliases: "base", "large", "xsmall", "disabled"
        - Local: "models/rerankers/mxbai-rerank-base-v1"
        - HuggingFace: "mixedbread-ai/mxbai-rerank-base-v1"

        Request JSON:
            {
                "enabled": true,           # Enable/disable reranking
                "model": "base",           # Model alias, path, or HuggingFace ID
                "top_n": 6                 # Top N results (optional)
            }

        Response JSON:
            {
                "success": true,
                "config": {...},           # Updated configuration
                "message": "..."
            }
        """
        try:
            data = request.json or {}

            enabled = data.get("enabled", True)
            model = data.get("model")
            top_n = data.get("top_n")

            # Handle "disabled" model as enabled=False
            if model and model.lower() == "disabled":
                enabled = False
                model = None

            # Validate top_n if provided
            if top_n is not None:
                if not isinstance(top_n, int) or top_n < 1 or top_n > 50:
                    return jsonify({
                        "success": False,
                        "error": "top_n must be an integer between 1 and 50"
                    }), 400

            # Resolve model path to check if it's valid
            resolved = None
            if model and enabled:
                resolved = resolve_model_path(model)
                if resolved is None:
                    enabled = False

            # Apply configuration
            new_config = set_reranker_config(
                model=model,
                enabled=enabled,
                top_n=top_n
            )

            # Build message
            if not enabled:
                message = "Reranker disabled"
            elif model:
                if new_config.get("is_groq", False):
                    source = "Groq"
                elif model.lower() in {"xsmall", "xsmall-v1", "base", "base-v1", "large", "large-v1"}:
                    source = "local cross-encoder"
                elif new_config.get("is_local", False):
                    source = "local model"
                else:
                    source = "HuggingFace"
                message = f"Reranker model changed to {model} ({source}), will load on next query"
            else:
                message = "Reranker configuration updated"

            logger.info(f"Reranker settings updated: {new_config}")

            return jsonify({
                "success": True,
                "config": new_config,
                "message": message
            })

        except Exception as e:
            logger.error(f"Error updating reranker config: {e}")
            return jsonify({
                "success": False,
                "error": str(e)
            }), 500

    @app.route("/api/settings/reranker/preload", methods=["POST"])
    def preload_reranker():
        """
        Preload the reranker model into memory.

        Useful for ensuring the model is ready before handling requests.
        The model will be loaded using the current configuration.

        Response JSON:
            {
                "success": true,
                "config": {...},
                "message": "Reranker model loaded successfully"
            }
        """
        try:
            from ...core.providers.reranker_provider import get_shared_reranker

            config = get_reranker_config()
            if not config["enabled"]:
                return jsonify({
                    "success": False,
                    "error": "Reranker is disabled. Enable it first."
                }), 400

            # This will trigger model loading if not already loaded
            reranker = get_shared_reranker(
                model=config["model"],
                top_n=config["top_n"]
            )

            if reranker is None:
                return jsonify({
                    "success": False,
                    "error": "Failed to load reranker"
                }), 500

            # Get updated config (should show loaded=True)
            new_config = get_reranker_config()

            logger.info(f"Reranker preloaded: {new_config}")

            return jsonify({
                "success": True,
                "config": new_config,
                "message": f"Reranker model '{config['model']}' loaded successfully"
            })

        except Exception as e:
            logger.error(f"Error preloading reranker: {e}")
            return jsonify({
                "success": False,
                "error": str(e)
            }), 500

    return app
