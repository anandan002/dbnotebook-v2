# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**DBNotebook** - A multimodal RAG system using LlamaIndex, PostgreSQL/pgvector, and Flask. Features NotebookLM-style document organization, persistent conversations, RAPTOR hierarchical retrieval, hybrid BM25+vector search, multi-provider LLM support (Ollama, OpenAI, Anthropic, Gemini), vision-based image understanding, Content Studio for multimodal content generation, Excel Analytics with AI-powered dashboard generation, SQL Chat (natural language to SQL) with multi-database support, and agentic query analysis with document routing.

## Development Commands

**LOCAL DEVELOPMENT (PREFERRED)**: Use `./scripts/sh/dev.sh` with local PostgreSQL on port 5432.

```bash
# First-time setup
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
brew services start postgresql@17        # macOS - start PostgreSQL
createdb dbnotebook_dev                   # Create database if needed

# Local development (PREFERRED method)
./scripts/sh/dev.sh local                # Start Flask backend locally (uses venv, localhost:5432)
./scripts/sh/dev.sh                      # Shows usage help
./scripts/sh/dev.sh status               # Check status of all services
./scripts/sh/dev.sh stop                 # Stop all services
./scripts/sh/dev.sh logs                 # Follow Docker container logs

# Local PostgreSQL setup
# - PostgreSQL running on localhost:5432
# - Database: dbnotebook_dev
# - User/Password: dbnotebook/dbnotebook
# - Default login: admin / admin123
# - .env uses host.docker.internal but scripts/sh/dev.sh replaces with localhost

# Docker deployment (for production-like testing)
./scripts/sh/dev.sh docker               # Build and start Docker container (port 7007)
docker compose up --build     # Alternative: direct docker compose
docker compose up -d          # Run in background
docker compose logs -f        # Follow logs

# Docker development workflow (hot reload via volume mounts)
# Backend changes: ./dbnotebook/ mounted - changes apply instantly
# Frontend changes: npm run build, then refresh browser
# Config changes: ./config/ mounted - restart container to apply

# Frontend development (React + Vite)
cd frontend
npm install
npm run dev                   # Dev server on :3000 (proxies to Flask :7860)
npm run build                 # Production build (tsc -b && vite build)
npm run lint                  # ESLint
npm run preview               # Preview production build

# Database migrations (Alembic) - run inside container or with PYTHONPATH
docker compose exec dbnotebook alembic upgrade head
docker compose exec dbnotebook alembic revision --autogenerate -m "description"

# Tests
pytest                        # All tests
pytest tests/test_notebook_integration.py  # Specific test
pytest tests/raptor/          # RAPTOR module tests
pytest -v -x                  # Verbose, stop on first failure

# Utility Scripts
python scripts/query_api_example.py --list-models   # List available LLM models
python scripts/query_api_example.py -m gpt-4.1-mini -q "Your query"  # Single query
python scripts/rebuild_raptor.py                     # Rebuild RAPTOR trees
python scripts/download_reranker_models.py           # Pre-download reranker models

# Load Testing (requires: pip install aiohttp)
python tests/simple_load_test.py                    # 100 concurrent users, local
python scripts/load_test_query_api.py               # Configurable cloud load test
```

## Quick Reference

**Add new provider**: Create class in `core/providers/`, register in `core/plugins.py`
**Add new route**: Create in `api/routes/`, register in `ui/web.py` via `create_*_routes()`
**Add new service**: Inherit `BaseService` in `core/services/`, inject via constructor
**Modify DB schema**: Edit `core/db/models.py`, then `alembic revision --autogenerate`
**Frontend component**: Add to `frontend/src/components/`, types in `frontend/src/types/`

## Architecture

### Core Data Flow

```
React Frontend (:3000) → Flask API (:7860) → LocalRAGPipeline
                                                    ↓
                              ┌─────────────────────┴─────────────────────┐
                              ↓                                           ↓
                    LocalDataIngestion                             LocalChatEngine
                    (document processing)                          (chat/retrieval)
                              ↓                                           ↓
                    RAPTOR TreeBuilder ←──────────────────────── LocalRetriever
                    (hierarchical summaries)                     (hybrid BM25+vector)
                              ↓                                           ↓
                    PGVectorStore ─────────────────────────────────────────
                    (PostgreSQL + pgvector)
                              ↓
                    LLM Response (SSE streaming)
```

### Key Components

**`dbnotebook/pipeline.py`** - Central orchestrator:
- Manages LLM/embedding providers, notebook context (`_current_notebook_id`, `_current_user_id`)
- Key methods: `switch_notebook()`, `store_nodes()`, `stream_chat()`, `set_chat_mode()`

**`dbnotebook/ui/web.py`** - Flask web interface:
- REST API + SSE streaming endpoints
- Integrates NotebookManager, MetadataManager, all providers

**`dbnotebook/core/services/`** - Service layer (inherit from `BaseService`):
- `chat_service.py` - Chat orchestration with refinement and suggestions
- `document_service.py` - Document upload and processing
- `multi_notebook_service.py` - Cross-notebook queries
- `continuity_service.py` - Session continuity
- `refinement_service.py` - Query refinement suggestions
- `document_routing_service.py` - Intelligent document routing
- `image_service.py` - Image generation orchestration
- All services receive `pipeline`, `db_manager`, `notebook_manager` via constructor

**`dbnotebook/core/vector_store/pg_vector_store.py`** - PGVectorStore:
- PostgreSQL + pgvector with JSONB metadata
- Duplicate prevention via md5(text) + notebook_id unique index
- Table: `data_embeddings`

**`dbnotebook/core/engine/retriever.py`** - LocalRetriever:
- ≤6 nodes: VectorIndexRetriever (pure semantic)
- \>6 nodes: RouterRetriever selecting:
  - QueryFusionRetriever (ambiguous): 5 query variations, fuses BM25+vector
  - TwoStageRetriever (clear): BM25+vector → reranker (`mixedbread-ai/mxbai-rerank-large-v1`)

### RAPTOR Hierarchical Retrieval

**`dbnotebook/core/raptor/`** - Implementation of [RAPTOR paper](https://arxiv.org/abs/2401.18059):
- `tree_builder.py` - Builds hierarchical summary trees bottom-up
- `clustering.py` - Semantic clustering of document chunks
- `summarizer.py` - LLM-based cluster summarization
- `retriever.py` - Multi-level retrieval across tree levels
- `worker.py` - Background RAPTOR tree building

Tree building flow: Document chunks (level 0) → Cluster by similarity → Summarize clusters (level 1) → Repeat until root

### AI Transformations

**`dbnotebook/core/transformations/`** - Document transformation service:
- `transformation_service.py` - Generates dense summaries, key insights, reflection questions
- Uses chunked processing for long documents (>10K chars)
- Async with sync wrapper for Flask routes

### Agents Module

**`dbnotebook/core/agents/`** - Agentic analysis components:
- `base.py` - Base agent interface
- `query_analyzer.py` - Analyzes queries to determine retrieval strategy
- `document_analyzer.py` - Analyzes document content for routing decisions

### Authentication & Multi-User

**`dbnotebook/core/auth/`** - Multi-user authentication system:
- `auth_service.py` - Login, password management, API key generation (bcrypt hashing)
- `rbac.py` - Role-based access control (admin, user roles)

**API Routes** (`/api/auth/*`):
- `POST /login` - Username/password authentication, returns session + API key
- `POST /logout` - End session
- `GET /me` - Current user info
- `POST /change-password` - Update password
- `POST /regenerate-api-key` - Generate new API key

**Default Credentials**: `admin` / `admin123`

**Admin Routes** (`/api/admin/*`): User management (create, delete, list users)

### SQL Chat (Chat with Data)

**`dbnotebook/core/sql_chat/`** - Natural language to SQL with multi-database support:
- `service.py` - SQLChatService: Main orchestrator for SQL chat functionality
- `connection.py` - Database connection management (PostgreSQL, MySQL, SQLite)
- `schema.py` - Schema introspection, caching, and dictionary generation
- `query_engine.py` - LlamaIndex NLSQLTableQueryEngine integration
- `query_learner.py` - Learns JOIN patterns from successful queries
- `few_shot_retriever.py` - RAG-based few-shot example retrieval from Gretel dataset
- `telemetry.py` - Query metrics and accuracy tracking
- `intent_classifier.py` - Classifies query intent (aggregation, join, filter, etc.)
- `confidence_scorer.py` - Confidence scoring for generated SQL
- `result_validator.py` - Validates SQL results before returning

**SQL Chat API Flow** (`/api/sql-chat/*`):
1. `POST /connections` - Create database connection with credentials
2. `POST /connections/test` - Test connection before saving
3. `GET /schema/<connection_id>` - Get schema with tables, columns, relationships
4. `POST /sessions` - Create chat session for a connection
5. `POST /query/<session_id>` - Execute natural language query → SQL → results
6. `POST /query/<session_id>/stream` - SSE streaming for query execution
7. `GET /connections/<connection_id>/dictionary` - Generate schema dictionary for RAG

**Key Features**:
- Read-only enforcement (prevents destructive queries)
- Schema fingerprinting for fast change detection
- Few-shot learning with Gretel dataset (~100K examples) via vector retrieval
- Confidence scoring and query validation
- Automatic notebook creation with schema dictionary for RAG queries

### Excel Analytics & AI Dashboards

Complete Excel/CSV analysis pipeline with LLM-powered dashboard generation.

**Backend** (`dbnotebook/core/analytics/`):
- `service.py` - AnalyticsService: Session management, file handling, orchestration
- `profiler.py` - DataProfiler: ydata-profiling integration for statistical analysis
- `dashboard_generator.py` - DashboardConfigGenerator: LLM-powered dashboard config generation
- `dashboard_modifier.py` - DashboardModifier: NLP-based dashboard modification agent
- `types.py` - Type definitions (ParsedData, ProfilingResult, DashboardConfig, ModificationResult)

**API Flow**:
1. `POST /api/analytics/upload` - Upload Excel/CSV file, create session
2. `POST /api/analytics/parse/{session_id}` - Parse with pandas, extract column metadata
3. `POST /api/analytics/profile/{session_id}` - Run ydata-profiling, generate quality score
4. `POST /api/analytics/analyze/{session_id}` - LLM generates dashboard config (KPIs, charts, filters)
5. `GET /api/analytics/sessions/{session_id}/data` - Get complete dashboard data
6. `POST /api/analytics/sessions/{session_id}/modify` - NLP-based dashboard modification
7. `POST /api/analytics/sessions/{session_id}/undo` - Undo last modification
8. `POST /api/analytics/sessions/{session_id}/redo` - Redo undone modification

**Frontend** (`frontend/src/components/Analytics/`):
- `ExcelUploader.tsx` - Drag-and-drop file upload
- `DashboardView.tsx` - Main dashboard with tabs (Dashboard, Data Profile), PDF export
- `DashboardModifier.tsx` - NLP modification input with undo/redo
- `KPICardGrid.tsx` - Renders KPI metric cards with aggregations
- `ChartGrid.tsx` - Bar/line/pie/scatter/area charts with cross-filtering, top 10 + "Others" grouping
- `FilterBar.tsx` - Interactive categorical/range/date filters
- `FilteredDataTable.tsx` - Displays filtered raw data with CSV download
- `ColumnProfileTable.tsx` - Sortable column statistics table
- `ColumnDetailPanel.tsx` - Detailed column statistics (numeric/categorical)

**State Management** (`frontend/src/contexts/AnalyticsContext.tsx`):
- `useAnalytics()` hook for session state, data, filters, modification history
- `useCrossFilter()` hook for cross-chart filtering
- Actions: `uploadFile()`, `runFullAnalysis()`, `modifyDashboard()`, `undoModification()`, `redoModification()`

**Types** (`frontend/src/types/analytics.ts`):
- `AnalysisState`: idle → uploading → parsing → profiling → analyzing → complete
- `DashboardConfig`: KPIs, charts, filters, metadata
- `FilterState`, `CrossFilterEvent` for interactive filtering
- `ModificationState` for undo/redo history

### Plugin Architecture

**`dbnotebook/core/registry.py`** - PluginRegistry:
```
├── LLM Providers: Ollama, OpenAI, Anthropic, Gemini, Groq
├── Embedding Providers: HuggingFace, OpenAI
├── Retrieval Strategies: Hybrid, Semantic, Keyword
├── Image Providers: Gemini/Imagen
├── Vision Providers: OpenAI GPT-4V, Gemini Vision
└── Web Search & Scraper: Tavily
```

**Groq Provider** (`core/providers/groq.py`): Ultra-fast inference (300-800 tok/s), supports Llama 4, Llama 3.x, Mixtral. Implements exponential backoff for rate limits.

Providers selected via env vars: `LLM_PROVIDER`, `EMBEDDING_PROVIDER`, `RETRIEVAL_STRATEGY`, `VISION_PROVIDER`

### Configuration System

**`config/*.yaml`** - YAML configuration files:
- `raptor.yaml` - Clustering, summarization, tree building params
- `ingestion.yaml` - Chunking, embedding, retrieval settings
- `models.yaml` - Model configurations

**`dbnotebook/core/config/config_loader.py`** - Loads and caches YAML configs:
```python
from dbnotebook.core.config import get_config_value
value = get_config_value('raptor', 'clustering', 'min_cluster_size', default=3)
```

### API Routes

Routes in `dbnotebook/api/routes/`:
- `auth.py` - `/api/auth/*` - Login, logout, password management
- `admin.py` - `/api/admin/*` - User management (admin only)
- `chat.py` - `/chat`, `/api/chat/*` - Chat and streaming
- `chat_v2.py` - `/api/v2/chat/*` - V2 Chat API with multi-user support
- `studio.py` - `/api/studio/*` - Content generation gallery
- `vision.py` - `/api/vision/*` - Image analysis
- `web_content.py` - `/api/web/*` - Web search and scraping
- `transformations.py` - `/api/transformations/*` - AI document transformations
- `multi_notebook.py` - `/api/multi-notebook/*` - Cross-notebook queries
- `analytics.py` - `/api/analytics/*` - Excel profiling and AI dashboard generation
- `agents.py` - `/api/agents/*` - Agentic query analysis endpoints
- `sql_chat.py` - `/api/sql-chat/*` - Natural language to SQL queries
- `query.py` - `/api/query` - Programmatic RAG API (for scripting/automation)
- `settings.py` - `/api/settings/*` - User settings management

Routes follow pattern: `create_*_routes(app, pipeline, db_manager, notebook_manager)`

### Programmatic API

Simple REST API for scripting and automation (`/api/query`):
```python
# POST /api/query
{
    "notebook_id": "uuid",
    "query": "What are the key findings?",
    "mode": "chat",           # Optional: chat|QA
    "include_sources": true,  # Optional
    "max_sources": 6          # Optional
}
# Returns: response, sources with scores, execution metadata
```
- Optional `X-API-Key` header auth via `API_KEY` env var
- `GET /api/query/notebooks` - List available notebooks

### Database Layer

**ORM**: SQLAlchemy 2.0 (`core/db/models.py`)
**Migrations**: Alembic (`/alembic/`)

**Tables**:
- `users` - User accounts with password hash, roles, API keys
- `notebooks` - Document collections with `user_id`
- `notebook_sources` - Documents with `active` toggle for RAG inclusion
- `conversations` - Persistent chat history per notebook
- `data_embeddings` - pgvector embeddings with JSONB metadata
- `generated_content` - Content Studio outputs
- `sql_connections` - Database connections for SQL Chat
- `sql_sessions` - Chat sessions for SQL queries
- `sql_query_history` - Query telemetry and metrics

## Environment Configuration

Copy `.env.example` to `.env`. Key variables:

```bash
# Core providers
LLM_PROVIDER=ollama              # ollama|openai|anthropic|gemini
LLM_MODEL=llama3.1:latest
EMBEDDING_PROVIDER=openai        # openai|huggingface
EMBEDDING_MODEL=text-embedding-3-small
RETRIEVAL_STRATEGY=hybrid        # hybrid|semantic|keyword

# Database
DATABASE_URL=postgresql://user:pass@localhost:5433/dbnotebook_dev
# Or individual settings:
POSTGRES_HOST=localhost
POSTGRES_PORT=5433
POSTGRES_DB=dbnotebook_dev

# pgvector embedding dimension (must match embedding model)
PGVECTOR_EMBED_DIM=1536          # 1536 for OpenAI, 768 for nomic

# Context Window
CONTEXT_WINDOW=128000            # Model context window (llama3.1 supports 128K)
CHAT_TOKEN_LIMIT=32000           # Chat memory buffer limit

# Vision & Image Generation
VISION_PROVIDER=gemini           # gemini|openai
IMAGE_GENERATION_PROVIDER=gemini
GEMINI_IMAGE_MODEL=gemini-3-pro-image-preview  # or imagen-4.0-generate-001

# Web Search & Scraping (optional)
TAVILY_API_KEY=...              # Required for web search - https://tavily.com/

# SQL Chat (optional)
SQL_CHAT_SKIP_READONLY_CHECK=false  # Set true for dev/testing only
SQL_CHAT_ENCRYPTION_KEY=...     # Fernet key for stored credentials
FEW_SHOT_MAX_EXAMPLES=100000    # Max examples for SQL generation

# Groq (optional - ultra-fast LLM inference)
GROQ_API_KEY=...                # Required when LLM_PROVIDER=groq
GROQ_MODEL=meta-llama/llama-4-scout-17b-16e-instruct  # Default model

# Authentication & Sessions
FLASK_SECRET_KEY=...            # Required for consistent sessions across workers
RBAC_STRICT_MODE=false          # Enable strict role-based access control
```

## Frontend

Located in `/frontend/`:
- **Stack**: React 19, Vite 7, Tailwind CSS 4, TypeScript
- **Theme**: Deep Space Terminal (dark theme)
- **Charts**: CSS-based (no external charting library)
- **Proxy**: Vite proxies `/api`, `/chat`, `/upload`, `/image` to Flask :7860
- **State**: React Context pattern - `AnalyticsContext`, `ChatContext`, `NotebookContext`, `DocumentContext`
- **v2 Components**: Alternative UI in `components/v2/` (NotebookLM-style layout)

## Key Defaults

- Flask (local): http://localhost:7860
- Flask (Docker): http://localhost:7007 (maps to container :7860)
- Frontend dev: http://localhost:3000
- PostgreSQL: localhost:5432 (local dev), localhost:5433 (.env default)
- Default login: admin / admin123
- Chunk size: 512 tokens, overlap: 32
- Similarity top-k: 20, rerank top-k: 6
- Embedding dimension: 1536 (OpenAI text-embedding-3-small) or 768 (nomic)
- Reranker: `mixedbread-ai/mxbai-rerank-large-v1`

## Document Processing Pipeline

1. Format-specific readers (PyMuPDF for PDFs, LangChain for Office docs)
2. Vision providers for images (Gemini/OpenAI)
3. MD5 hash duplicate detection
4. SentenceSplitter (512 tokens, 32 overlap)
5. HuggingFace embeddings (batch size 8)
6. Store in PGVectorStore with metadata
7. Optional: RAPTOR tree building for hierarchical summaries

## Common Patterns

### Adding a New LLM Provider
```python
# 1. core/providers/my_provider.py
class MyProvider(LLMProvider):
    def get_llm(self, **kwargs) -> LLM: ...
    def validate(self) -> bool: ...

# 2. core/plugins.py
PluginRegistry.register_llm_provider("my_provider", MyProvider)

# 3. .env
LLM_PROVIDER=my_provider
```

### Adding a New API Route
```python
# 1. api/routes/my_feature.py
def create_my_feature_routes(app, pipeline, db_manager, notebook_manager):
    @app.route('/api/my-feature', methods=['POST'])
    def my_endpoint(): ...

# 2. ui/web.py (in create_app)
from dbnotebook.api.routes.my_feature import create_my_feature_routes
create_my_feature_routes(app, pipeline, db_manager, notebook_manager)
```

### Service Layer Pattern
```python
# All services in core/services/ inherit BaseService
class MyService(BaseService):
    def __init__(self, pipeline, db_manager, notebook_manager):
        super().__init__(pipeline, db_manager, notebook_manager)
```

## Debugging Tips

- **Chat not retrieving**: Check `_current_notebook_id` is set in pipeline
- **Embeddings failing**: Verify `EMBEDDING_MODEL` and `PGVECTOR_EMBED_DIM` match (1536 for OpenAI, 768 for nomic)
- **RAPTOR tree not building**: Check `raptor_status` in `notebook_sources` table
- **Frontend proxy issues**: Ensure Flask running on :7860 before `npm run dev`
- **Migration conflicts**: Run `alembic heads` to check for multiple heads
- **LLM connection issues**: Check `OLLAMA_HOST` (default: localhost:11434, Docker uses host.docker.internal)
- **Context overflow**: Reduce `CHAT_TOKEN_LIMIT` or increase `CONTEXT_WINDOW`
- **SQL Chat connection fails**: Verify database credentials, check read-only enforcement, ensure `SQL_CHAT_SKIP_READONLY_CHECK` if needed
- **Docker backend changes not reflected**: Check volume mount in docker-compose.yml (`./dbnotebook:/app/dbnotebook`)
- **Frontend build issues**: Run `npm run lint` and check TypeScript errors (build runs `tsc -b` first)
- **Model detection**: Check `LocalRAGModel` in `core/model/model.py` for supported model names per provider
- **Auth issues**: Check `FLASK_SECRET_KEY` is set for session persistence, verify `users` table has admin user
- **Groq rate limits**: Provider implements exponential backoff (5 retries, 60s max), check logs for "rate limited" warnings
- **Load testing**: Requires `pip install aiohttp` for async load tests
- **RAPTOR rebuild**: Use `python scripts/rebuild_raptor.py` to rebuild hierarchical summaries for a notebook
