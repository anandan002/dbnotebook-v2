"""Content Studio API routes."""

import logging
import os
import base64
import tempfile
from flask import request, jsonify, send_file
from pathlib import Path

from ...core.studio import StudioManager, InfographicGenerator, MindMapGenerator
from ...core.ingestion import SynopsisManager
from ...core.vision import VisionManager

logger = logging.getLogger(__name__)

# Brand extraction prompt for Vision API
BRAND_EXTRACTION_PROMPT = """Analyze this image and extract branding information for use in infographic generation.

Please identify and return:
1. COLORS: List the dominant colors in hex format (e.g., #FF5733, #2E86AB). Focus on brand colors, not background.
2. COMPANY_NAME: If a company/brand name is visible, extract it exactly as shown.
3. LOGO_DESCRIPTION: Describe the logo style (e.g., "modern minimalist icon", "wordmark with geometric shapes")
4. STYLE_NOTES: Describe the overall design style (e.g., "corporate professional", "modern tech", "playful colorful")
5. FONTS: Describe the font style if visible (e.g., "sans-serif bold", "serif elegant")

Format your response as:
COLORS: #hex1, #hex2, #hex3
COMPANY_NAME: [name or "Not visible"]
LOGO_DESCRIPTION: [description]
STYLE_NOTES: [description]
FONTS: [description or "Not determined"]
"""

# Project root directory for resolving relative paths
PROJECT_ROOT = Path(__file__).parent.parent.parent.parent


def _get_app_base_path() -> str:
    """Get normalized app base path for subpath deployments."""
    base_path = os.getenv("DBNOTEBOOK_BASE_PATH", "").strip()
    if not base_path or base_path == "/":
        return ""

    if not base_path.startswith("/"):
        base_path = f"/{base_path}"

    normalized = base_path.rstrip("/")
    return "" if normalized == "/" else normalized


def _with_app_base(path: str) -> str:
    """Prefix an absolute app path with configured base path, if needed."""
    if not path:
        return path

    normalized_path = path if path.startswith("/") else f"/{path}"
    app_base = _get_app_base_path()

    if not app_base:
        return normalized_path

    if normalized_path == app_base or normalized_path.startswith(f"{app_base}/"):
        return normalized_path

    return f"{app_base}{normalized_path}"


def _parse_brand_extraction_response(response_text: str) -> dict:
    """Parse the brand extraction response from Vision API."""
    brand_info = {}

    lines = response_text.strip().split('\n')
    for line in lines:
        line = line.strip()
        if line.startswith('COLORS:'):
            colors = line.replace('COLORS:', '').strip()
            brand_info['colors'] = colors
        elif line.startswith('COMPANY_NAME:'):
            name = line.replace('COMPANY_NAME:', '').strip()
            if name.lower() not in ['not visible', 'n/a', 'none', '']:
                brand_info['company_name'] = name
        elif line.startswith('LOGO_DESCRIPTION:'):
            desc = line.replace('LOGO_DESCRIPTION:', '').strip()
            brand_info['logo_description'] = desc
        elif line.startswith('STYLE_NOTES:'):
            notes = line.replace('STYLE_NOTES:', '').strip()
            brand_info['style_notes'] = notes
        elif line.startswith('FONTS:'):
            fonts = line.replace('FONTS:', '').strip()
            if fonts.lower() not in ['not determined', 'n/a', 'none', '']:
                brand_info['fonts'] = fonts

    return brand_info


def _extract_brand_from_image(vision_manager: VisionManager, image_path: str) -> dict:
    """Extract brand information from a reference image using Vision API."""
    try:
        result = vision_manager.analyze_image(
            image_path=image_path,
            prompt=BRAND_EXTRACTION_PROMPT
        )

        if result and result.description:
            brand_info = _parse_brand_extraction_response(result.description)
            logger.info(f"Extracted brand info: {brand_info}")
            return brand_info

    except Exception as e:
        logger.warning(f"Failed to extract brand info from image: {e}")

    return {}


def create_studio_routes(
    app,
    studio_manager: StudioManager,
    synopsis_manager: SynopsisManager = None,
    pipeline=None,
):
    """Create Content Studio API routes.

    Args:
        app: Flask application instance
        studio_manager: StudioManager instance
        synopsis_manager: SynopsisManager for getting notebook content (fallback)
        pipeline: LocalRAGPipeline for retrieval-based content selection (same as Chat)
    """

    # Initialize vision manager for brand extraction
    vision_manager = None
    try:
        vision_manager = VisionManager()
        logger.info("Vision manager initialized for brand extraction")
    except Exception as e:
        logger.warning(f"Vision manager not available for brand extraction: {e}")

    # Initialize generators
    generators = {}
    try:
        generators["infographic"] = InfographicGenerator()
        generators["mindmap"] = MindMapGenerator()
        logger.info("Content Studio generators initialized")
    except Exception as e:
        logger.warning(f"Some generators not available: {e}")

    @app.route("/api/studio/gallery", methods=["GET"])
    def get_gallery():
        """
        Get gallery of generated content.

        Query params:
            type: Optional content type filter
            notebook_id: Optional notebook filter
            limit: Max results (default 50)
            offset: Pagination offset

        Response JSON:
            {
                "success": true,
                "items": [
                    {
                        "content_id": "uuid",
                        "content_type": "infographic",
                        "title": "...",
                        "thumbnail_url": "/api/studio/content/uuid/thumbnail",
                        "created_at": "2024-01-01T00:00:00"
                    }
                ],
                "total": 10
            }
        """
        try:
            # Get default user ID for now
            user_id = "00000000-0000-0000-0000-000000000001"

            content_type = request.args.get("type")
            notebook_id = request.args.get("notebook_id")
            limit = min(int(request.args.get("limit", 50)), 100)
            offset = int(request.args.get("offset", 0))

            items = studio_manager.list_gallery(
                user_id=user_id,
                content_type=content_type,
                notebook_id=notebook_id,
                limit=limit,
                offset=offset,
            )

            # Add thumbnail URLs
            for item in items:
                item["thumbnail_url"] = _with_app_base(f"/api/studio/content/{item['content_id']}/thumbnail")
                item["file_url"] = _with_app_base(f"/api/studio/content/{item['content_id']}/file")

            return jsonify({
                "success": True,
                "items": items,
                "total": len(items),
            })

        except Exception as e:
            logger.error(f"Error getting gallery: {e}")
            return jsonify({
                "success": False,
                "error": str(e)
            }), 500

    @app.route("/api/studio/generate", methods=["POST"])
    def generate_content():
        """
        Generate new content from a notebook.

        Request JSON:
            {
                "notebook_id": "uuid",
                "type": "infographic" | "mindmap",
                "prompt": "Optional additional instructions",
                "aspect_ratio": "16:9" (optional),
                "reference_image": "base64 encoded image" (optional - for brand extraction)
            }

        Response JSON:
            {
                "success": true,
                "content": {
                    "content_id": "uuid",
                    "content_type": "infographic",
                    "title": "...",
                    "file_url": "..."
                }
            }
        """
        try:
            data = request.json or {}
            notebook_id = data.get("notebook_id")
            content_type = data.get("type", "infographic")
            prompt = data.get("prompt")
            aspect_ratio = data.get("aspect_ratio")

            if not notebook_id:
                return jsonify({
                    "success": False,
                    "error": "notebook_id is required"
                }), 400

            if content_type not in generators:
                return jsonify({
                    "success": False,
                    "error": f"Unknown content type: {content_type}. Available: {list(generators.keys())}"
                }), 400

            generator = generators[content_type]

            if not generator.validate():
                return jsonify({
                    "success": False,
                    "error": f"Generator {content_type} is not available. Check API keys."
                }), 503

            # Get notebook content using RAG pipeline (same as Chat)
            # Two-step process: 1) RAG retrieval + LLM synthesis, 2) Image generation
            content = ""

            # Build a query for the RAG pipeline to extract key information
            rag_query = prompt if prompt else f"Provide a comprehensive summary of the key topics, main points, and important information that would be suitable for creating a visual {content_type}. Focus on the most important facts, relationships, and insights."

            # Use RAG pipeline to get synthesized content (same as Chat uses)
            if pipeline:
                try:
                    # Switch pipeline to this notebook
                    pipeline.switch_notebook(notebook_id)

                    # Check if we have a query engine
                    if hasattr(pipeline, '_query_engine') and pipeline._query_engine:
                        # Use sync chat to get RAG-enhanced response
                        logger.info(f"Content Studio: Running RAG query for notebook {notebook_id}")

                        # Use .chat() for synchronous response (not streaming)
                        rag_response = pipeline._query_engine.chat(rag_query)

                        if rag_response and hasattr(rag_response, 'response'):
                            content = str(rag_response.response)
                            logger.info(f"Content Studio: RAG returned {len(content)} chars of synthesized content")
                        elif rag_response:
                            content = str(rag_response)
                            logger.info(f"Content Studio: RAG returned {len(content)} chars")
                    else:
                        logger.warning("Query engine not available, falling back to direct node extraction")

                except Exception as e:
                    logger.warning(f"RAG query failed: {e}, falling back to direct extraction")
                    import traceback
                    logger.warning(traceback.format_exc())

            # Fallback: Direct node extraction if RAG fails
            if not content and pipeline and hasattr(pipeline, '_vector_store') and pipeline._vector_store:
                try:
                    nodes = pipeline._vector_store.get_nodes_by_notebook_sql(notebook_id)
                    if nodes:
                        node_texts = []
                        seen_prefixes = set()
                        for node in nodes:
                            text = node.get_content() if hasattr(node, 'get_content') else str(node.text)
                            prefix = text[:100] if text else ""
                            if prefix and prefix not in seen_prefixes:
                                seen_prefixes.add(prefix)
                                node_texts.append(text)
                        content = "\n\n".join(node_texts)[:6000]
                        logger.info(f"Content Studio: Fallback - extracted {len(content)} chars from {len(node_texts)} chunks")
                except Exception as e:
                    logger.warning(f"Fallback extraction failed: {e}")

            # Last resort: Synopsis manager
            if not content and synopsis_manager:
                try:
                    synopsis = synopsis_manager.get_synopsis(notebook_id)
                    content = synopsis.get("synopsis", "") if synopsis else ""
                    if content:
                        logger.info(f"Using synopsis for notebook {notebook_id}")
                except Exception as e:
                    logger.warning(f"Could not get synopsis: {e}")

            if not content:
                logger.warning(f"No content found for notebook {notebook_id}")
                return jsonify({
                    "success": False,
                    "error": "No content found in notebook. Please add documents first."
                }), 400

            # Generate the content
            kwargs = {}
            if aspect_ratio:
                kwargs["aspect_ratio"] = aspect_ratio

            # Extract brand info from reference image if provided
            reference_image = data.get("reference_image")
            if reference_image and vision_manager:
                try:
                    # Decode base64 image and save to temp file
                    image_data = base64.b64decode(reference_image)
                    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp_file:
                        tmp_file.write(image_data)
                        tmp_path = tmp_file.name

                    # Extract brand info using Vision API
                    brand_info = _extract_brand_from_image(vision_manager, tmp_path)
                    if brand_info:
                        kwargs["brand_info"] = brand_info
                        logger.info(f"Extracted brand info from reference image: {brand_info}")

                    # Clean up temp file
                    os.unlink(tmp_path)
                except Exception as e:
                    logger.warning(f"Could not extract brand info from reference image: {e}")

            result = generator.generate(
                content=content,
                prompt=prompt,
                **kwargs
            )

            # Get default user ID
            user_id = "00000000-0000-0000-0000-000000000001"

            # Save to database
            created = studio_manager.create_content(
                user_id=user_id,
                content_type=content_type,
                title=result["title"],
                file_path=result["file_path"],
                prompt_used=prompt,
                source_notebook_id=notebook_id,
                thumbnail_path=result.get("thumbnail_path"),
                metadata=result.get("metadata"),
            )

            # Add URLs
            created["file_url"] = _with_app_base(f"/api/studio/content/{created['content_id']}/file")
            created["thumbnail_url"] = _with_app_base(f"/api/studio/content/{created['content_id']}/thumbnail")

            return jsonify({
                "success": True,
                "content": created,
            })

        except RuntimeError as e:
            logger.error(f"Generation failed: {e}")
            return jsonify({
                "success": False,
                "error": str(e)
            }), 503
        except Exception as e:
            logger.error(f"Error generating content: {e}")
            return jsonify({
                "success": False,
                "error": str(e)
            }), 500

    @app.route("/api/studio/content/<content_id>", methods=["GET"])
    def get_content(content_id):
        """
        Get content details.

        Response JSON:
            {
                "success": true,
                "content": {
                    "content_id": "uuid",
                    "content_type": "infographic",
                    "title": "...",
                    "file_url": "...",
                    "metadata": {...}
                }
            }
        """
        try:
            content = studio_manager.get_content(content_id)

            if not content:
                return jsonify({
                    "success": False,
                    "error": "Content not found"
                }), 404

            # Add URLs
            content["file_url"] = _with_app_base(f"/api/studio/content/{content_id}/file")
            content["thumbnail_url"] = _with_app_base(f"/api/studio/content/{content_id}/thumbnail")

            return jsonify({
                "success": True,
                "content": content,
            })

        except Exception as e:
            logger.error(f"Error getting content: {e}")
            return jsonify({
                "success": False,
                "error": str(e)
            }), 500

    @app.route("/api/studio/content/<content_id>/file", methods=["GET"])
    def get_content_file(content_id):
        """Serve the generated content file."""
        try:
            content = studio_manager.get_content(content_id)

            if not content:
                return jsonify({
                    "success": False,
                    "error": "Content not found"
                }), 404

            # Resolve relative paths from project root
            file_path = Path(content["file_path"])
            if not file_path.is_absolute():
                file_path = PROJECT_ROOT / file_path

            if not file_path.exists():
                logger.error(f"File not found: {file_path}")
                return jsonify({
                    "success": False,
                    "error": "File not found"
                }), 404

            # Determine mimetype from extension
            mimetype = "image/jpeg" if file_path.suffix.lower() in [".jpg", ".jpeg"] else "image/png"

            return send_file(
                file_path,
                mimetype=mimetype,
                as_attachment=False,
            )

        except Exception as e:
            logger.error(f"Error serving file: {e}")
            return jsonify({
                "success": False,
                "error": str(e)
            }), 500

    @app.route("/api/studio/content/<content_id>/thumbnail", methods=["GET"])
    def get_content_thumbnail(content_id):
        """Serve the content thumbnail."""
        try:
            content = studio_manager.get_content(content_id)

            if not content:
                return jsonify({
                    "success": False,
                    "error": "Content not found"
                }), 404

            thumbnail_path = content.get("thumbnail_path") or content.get("file_path")
            if not thumbnail_path:
                return jsonify({
                    "success": False,
                    "error": "Thumbnail not found"
                }), 404

            # Resolve relative paths from project root
            file_path = Path(thumbnail_path)
            if not file_path.is_absolute():
                file_path = PROJECT_ROOT / file_path

            if not file_path.exists():
                logger.error(f"Thumbnail not found: {file_path}")
                return jsonify({
                    "success": False,
                    "error": "Thumbnail file not found"
                }), 404

            # Determine mimetype from extension
            mimetype = "image/jpeg" if file_path.suffix.lower() in [".jpg", ".jpeg"] else "image/png"

            return send_file(
                file_path,
                mimetype=mimetype,
                as_attachment=False,
            )

        except Exception as e:
            logger.error(f"Error serving thumbnail: {e}")
            return jsonify({
                "success": False,
                "error": str(e)
            }), 500

    @app.route("/api/studio/content/<content_id>", methods=["DELETE"])
    def delete_content(content_id):
        """
        Delete generated content.

        Response JSON:
            {
                "success": true,
                "message": "Content deleted"
            }
        """
        try:
            deleted = studio_manager.delete_content(content_id)

            if not deleted:
                return jsonify({
                    "success": False,
                    "error": "Content not found"
                }), 404

            return jsonify({
                "success": True,
                "message": "Content deleted"
            })

        except Exception as e:
            logger.error(f"Error deleting content: {e}")
            return jsonify({
                "success": False,
                "error": str(e)
            }), 500

    @app.route("/api/studio/generators", methods=["GET"])
    def list_generators():
        """
        List available generators.

        Response JSON:
            {
                "success": true,
                "generators": [
                    {
                        "type": "infographic",
                        "name": "Infographic Generator",
                        "available": true,
                        "description": "..."
                    }
                ]
            }
        """
        try:
            generator_info = []
            for gen_type, generator in generators.items():
                info = generator.get_generator_info()
                generator_info.append(info)

            return jsonify({
                "success": True,
                "generators": generator_info,
            })

        except Exception as e:
            logger.error(f"Error listing generators: {e}")
            return jsonify({
                "success": False,
                "error": str(e)
            }), 500

    return app
