# FOR_BHARATH.md - DBNotebook Technical Reference

> *A comprehensive techno-functional guide to the DBNotebook codebase.*

---

# Part 1: Overview

## 1.1 What Is DBNotebook?

**DBNotebook** is a multimodal RAG (Retrieval-Augmented Generation) system that lets you have conversations with your documents. Upload PDFs, Word files, images, web pages—then ask questions and get intelligent answers with source citations.

**Key Capabilities**:
- **RAG Chat** - Conversational Q&A with document retrieval, RAPTOR hierarchical summaries, and reranking
- **SQL Chat** - Natural language to SQL with multi-database support (PostgreSQL, MySQL, SQLite)
- **Analytics** - Upload Excel/CSV files and get AI-generated interactive dashboards
- **Content Studio** - Generate infographics and mindmaps from notebook content
- **Vision** - Image understanding and OCR via Gemini/OpenAI vision models
- **Programmatic API** - REST API for scripting, automation, and external integrations

**Tech Stack**: Flask + React 19 + PostgreSQL/pgvector + LlamaIndex + Multi-provider LLM support (Groq, OpenAI, Anthropic, Gemini, Ollama)

---

## 1.2 System Architecture

```
┌─────────────────────────────────────────┐     ┌─────────────────────────┐
│           React Frontend (:3000)        │     │   External Clients      │
│  ┌─────────┐ ┌─────────┐ ┌──────────┐   │     │  ┌─────┐ ┌─────┐ ┌───┐  │
│  │ RAG Chat│ │SQL Chat │ │Analytics │   │     │  │Bots │ │CI/CD│ │...│  │
│  └────┬────┘ └────┬────┘ └────┬─────┘   │     │  └──┬──┘ └──┬──┘ └─┬─┘  │
└───────┼──────────┼───────────┼──────────┘     └─────┼───────┼──────┼────┘
        │          │           │                      │       │      │
        ▼          ▼           ▼                      ▼       ▼      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Flask API (:7860)                               │
│  /api/v2/chat  │  /api/sql-chat  │  /api/analytics  │  /api/query      │
│                                                      │  (+ X-API-Key)   │
└───────┬────────────────┬────────────────┬───────────────────┬───────────┘
        │                │                │                   │
        ▼                ▼                ▼                   │
┌───────────────┐  ┌──────────────┐  ┌─────────────────┐      │
│LocalRAGPipeline│  │SQLChatService│  │AnalyticsService │ ◄────┘
│  (The Brain)  │  │(Text-to-SQL) │  │ (Excel Magic)   │
└───────┬───────┘  └──────┬───────┘  └────────┬────────┘
        │                 │                   │
        ▼                 ▼                   ▼
┌─────────────────────────────────────────────────────────────┐
│                   PostgreSQL + pgvector                      │
│  ┌─────────────┐  ┌───────────┐  ┌──────────────────────┐   │
│  │data_embeddings│ │ notebooks │  │ sql_connections     │   │
│  │(vectors+text) │ │ (sources) │  │ (DB credentials)    │   │
│  └─────────────┘  └───────────┘  └──────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### The Four Core Flows

**1. RAG Chat**: Documents → Chunking → Embedding → pgvector → Hybrid retrieval (BM25 + semantic) → RAPTOR summaries → Reranking → LLM response with citations

**2. SQL Chat**: Database connection → Schema introspection → Natural language query → Intent classification → Few-shot SQL generation → Validation → Execution → Results

**3. Analytics**: Excel/CSV upload → ydata-profiling analysis → LLM dashboard generation → Interactive charts with cross-filtering

**4. Programmatic API**: `POST /api/query` + API key → Notebook lookup → RAG pipeline → JSON response with sources + session memory

---

# Part 2: Codebase & Architecture

## 2.1 Directory Structure

### Quick Reference

| What You Want | Where To Look |
|---------------|---------------|
| Chat behavior | `dbnotebook/pipeline.py` |
| Document chunking | `dbnotebook/core/ingestion/ingestion.py` |
| Retrieval logic | `dbnotebook/core/engine/retriever.py` |
| RAPTOR trees | `dbnotebook/core/raptor/` |
| SQL generation | `dbnotebook/core/sql_chat/service.py` |
| Quiz system | `dbnotebook/core/services/quiz_service.py` |
| API endpoints | `dbnotebook/api/routes/` |
| Frontend components | `frontend/src/components/` |
| Database models | `dbnotebook/core/db/models.py` |
| Configuration | `config/*.yaml` + `.env` |

### Root Level

```
dbn-v2/
├── .claude/                # Claude Code configuration
├── .github/                # GitHub Actions workflows
├── alembic/                # Database migrations
│   └── versions/           # Migration scripts
├── config/                 # YAML configuration
│   ├── raptor.yaml         # RAPTOR settings
│   ├── ingestion.yaml      # Chunking & retrieval
│   └── models.yaml         # Model configs
├── data/                   # Data storage
│   ├── huggingface/        # Cached models
│   └── sqlite/             # SQLite DBs
├── deploy/                 # Deployment configs
├── docs/                   # Documentation
├── models/                 # Downloaded models
│   └── rerankers/          # Reranker weights
├── outputs/                # Generated outputs
├── scripts/                # Utility scripts
├── tests/                  # Test suite
├── uploads/                # Uploaded files
├── frontend/               # React frontend
└── dbnotebook/             # Python backend
```

### Backend: `dbnotebook/`

```
dbnotebook/
├── pipeline.py              # Central orchestrator (1,879 LOC)
│
├── api/
│   ├── core/                # Shared API infrastructure
│   │   ├── response.py      # Response builders
│   │   ├── exceptions.py    # Custom exceptions
│   │   └── decorators.py    # Auth decorators
│   └── routes/              # REST API endpoints
│       ├── auth.py          # /api/auth/*
│       ├── admin.py         # /api/admin/*
│       ├── chat.py          # /chat, /api/chat/*
│       ├── chat_v2.py       # /api/v2/chat/*
│       ├── query.py         # /api/query (programmatic)
│       ├── studio.py        # /api/studio/*
│       ├── vision.py        # /api/vision/*
│       ├── web_content.py   # /api/web/*
│       ├── transformations.py  # /api/transformations/*
│       ├── multi_notebook.py   # /api/multi-notebook/*
│       ├── analytics.py     # /api/analytics/*
│       ├── agents.py        # /api/agents/*
│       ├── sql_chat.py      # /api/sql-chat/*
│       ├── quiz.py          # /api/quiz/*
│       └── settings.py      # /api/settings/*
│
├── core/
│   ├── agents/              # Agentic analysis
│   ├── analytics/           # Excel dashboards
│   ├── auth/                # Authentication & RBAC
│   ├── config/              # Config loading
│   ├── conversation/        # Conversation management
│   ├── db/                  # Database layer
│   ├── embedding/           # Embedding generation
│   ├── engine/              # Retrieval engine
│   ├── image/               # Image generation
│   ├── ingestion/           # Document ingestion
│   ├── memory/              # Session memory
│   ├── metadata/            # Metadata management
│   ├── model/               # Model detection
│   ├── notebook/            # Notebook management
│   ├── observability/       # Monitoring & logging
│   ├── prompt/              # Prompt templates
│   ├── providers/           # LLM/Embedding providers
│   │   ├── ollama.py
│   │   ├── openai.py
│   │   ├── anthropic.py
│   │   ├── gemini.py
│   │   └── groq.py
│   ├── raptor/              # RAPTOR hierarchical retrieval
│   │   ├── tree_builder.py
│   │   ├── clustering.py
│   │   ├── summarizer.py
│   │   ├── retriever.py
│   │   └── worker.py
│   ├── services/            # Business logic services
│   ├── sql_chat/            # Text-to-SQL
│   ├── stateless/           # Multi-user query patterns
│   ├── strategies/          # Retrieval strategies
│   ├── studio/              # Content Studio
│   ├── transformations/     # AI transformations
│   ├── vector_store/        # pgvector integration
│   └── vision/              # Vision providers
│
└── ui/
    └── web.py               # Flask app factory (2,037 LOC)
```

### Frontend: `frontend/`

```
frontend/
├── src/
│   ├── main.tsx             # Entry point
│   ├── App.tsx              # Root component
│   ├── components/
│   │   ├── Admin/           # User management
│   │   ├── Agentic/         # Query refinement, insights
│   │   ├── Analytics/       # Dashboard components
│   │   ├── Chat/            # RAG chat UI
│   │   ├── SQLChat/         # SQL chat UI
│   │   └── v2/              # NotebookLM-style layout
│   ├── contexts/            # React Context (state)
│   ├── hooks/               # Custom hooks
│   ├── pages/               # Page components
│   ├── services/            # API client
│   └── types/               # TypeScript types
├── package.json
├── vite.config.ts
└── tailwind.config.js
```

### Key Files

| File | Purpose |
|------|---------|
| `pipeline.py` | Central orchestrator - LLM init, node cache, retrieval, chat |
| `core/engine/retriever.py` | Hybrid retrieval with smart routing |
| `core/vector_store/pg_vector_store.py` | pgvector operations, deduplication |
| `core/stateless/retrieval.py` | Thread-safe multi-user queries |
| `ui/web.py` | Flask app factory, route registration |

---

## 2.2 Tech Stack

### Core Technologies

| Technology | Purpose | Why |
|------------|---------|-----|
| **Flask** | Web framework | Simple, flexible, perfect for APIs |
| **PostgreSQL + pgvector** | Vector database | One DB for everything, no sync issues |
| **LlamaIndex** | RAG framework | Best retrieval abstractions |
| **React 19 + Vite** | Frontend | Latest React, fast builds |
| **SQLAlchemy 2.0** | ORM | Type-safe, async support |

### LLM Providers

| Provider | Use Case | Speed |
|----------|----------|-------|
| **Groq** | Primary (speed) | 300-800 tok/s |
| **OpenAI** | Quality + embeddings | ~50 tok/s |
| **Ollama** | Local/privacy | Varies |
| **Anthropic** | Alternative | ~40 tok/s |
| **Gemini** | Vision + images | ~60 tok/s |

### Embeddings

**Default**: OpenAI `text-embedding-3-small` (1536 dimensions)
**Alternative**: `nomic-embed-text-v1.5` (768 dimensions) for local

### Reranker

**Model**: `mixedbread-ai/mxbai-rerank-large-v1`
**Options**: `xsmall` (~0.5s), `base` (~1.5s), `large` (~4s)

---

## 2.3 Database Schema

### Core Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `users` | User accounts | `user_id`, `username`, `password_hash`, `role`, `api_key` |
| `notebooks` | Document collections | `notebook_id`, `user_id`, `name`, `created_at` |
| `notebook_sources` | Documents | `source_id`, `notebook_id`, `filename`, `active`, `raptor_status` |
| `conversations` | Chat history | `conversation_id`, `notebook_id`, `user_id`, `role`, `content` |
| `data_embeddings` | Vector storage | `id`, `notebook_id`, `text`, `embedding` (vector), `metadata` (JSONB) |
| `generated_content` | Studio outputs | `content_id`, `user_id`, `content_type`, `file_path` |

### SQL Chat Tables

| Table | Purpose |
|-------|---------|
| `sql_connections` | DB credentials (encrypted) |
| `sql_sessions` | Chat sessions |
| `sql_query_history` | Query telemetry |

### Quiz Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `quizzes` | Quiz configuration | `notebook_id`, `title`, `difficulty_mode`, `llm_model`, `is_active` |
| `quiz_attempts` | Attempt tracking | `quiz_id`, `taker_name`, `taker_email`, `score`, `answers` (JSONB) |

### Relationships

```
users (1) ──────┬──── (N) notebooks
                │
                └──── (N) sql_connections ──── (N) sql_sessions

notebooks (1) ──┬──── (N) notebook_sources
                ├──── (N) data_embeddings
                └──── (N) conversations
```

---

## 2.4 Configuration System

### File Hierarchy (Priority Order)

| Source | Purpose |
|--------|---------|
| `.env` | Secrets, environment-specific (highest priority) |
| `config/raptor.yaml` | RAPTOR tree building |
| `config/ingestion.yaml` | Chunking, retrieval |
| `config/models.yaml` | Model configurations |
| Code defaults | Fallback values |

### Config Loader

```python
from dbnotebook.core.config import get_config_value

chunk_size = get_config_value('ingestion', 'chunking', 'chunk_size', default=512)
raptor_enabled = get_config_value('raptor', 'enabled', default=True)
```

### Key Configuration Values

**Ingestion (`config/ingestion.yaml`)**:
```yaml
chunking:
  chunk_size: 512
  chunk_overlap: 32
embedding:
  batch_size: 8
retrieval:
  similarity_top_k: 20
  reranker_top_k: 6
```

**RAPTOR (`config/raptor.yaml`)**:
```yaml
clustering:
  min_cluster_size: 3
  max_cluster_size: 10
summarization:
  max_input_tokens: 6000
tree_building:
  max_tree_depth: 4
```

---

# Part 3: Core Features

## 3.1 RAG Chat & Conversation Memory

### Retrieval Flow

```
Query → Expand (if follow-up) → Hybrid Retrieval (BM25 + Vector)
                                        │
                        ┌───────────────┴───────────────┐
                        ▼                               ▼
                Small index (≤6 nodes)          Large index (>6 nodes)
                        │                               │
                        ▼                               ▼
                VectorIndexRetriever            RouterRetriever
                (pure semantic)                 ┌───────┴───────┐
                                                ▼               ▼
                                        QueryFusion      TwoStage
                                        (ambiguous)      (clear)
                                                │
                                                ▼
                                        Reranker → Top-K Results
```

### Memory Architecture

| Layer | Storage | Scope | Persistence |
|-------|---------|-------|-------------|
| **SessionMemoryService** | In-memory dict | Process lifetime | Ephemeral |
| **ConversationStore** | PostgreSQL | Per (notebook, user) | Permanent |
| **Query API Sessions** | In-memory dict | Per session_id | Ephemeral |

### ConversationStore (`core/conversation/conversation_store.py`)

PostgreSQL-backed persistent conversation history.

**Key Operations**:

| Method | Description |
|--------|-------------|
| `save_message(notebook_id, user_id, role, content)` | Save single message |
| `get_conversation_history(notebook_id, user_id, limit)` | Retrieve history |
| `clear_notebook_history(notebook_id)` | Delete all messages |

### Chat V2 Memory Flow

```
1. REQUEST: POST /api/v2/chat { notebook_id, user_id, query }
2. LOAD HISTORY from PostgreSQL
3. EXPAND follow-up queries ("tell me more" → "tell me more about RAPTOR")
4. RETRIEVE with expanded query
5. BUILD CONTEXT with history
6. EXECUTE LLM query
7. SAVE conversation turn to PostgreSQL
8. RETURN response
```

### Query Expansion

```python
def expand_query_with_history(query, conversation_history, llm):
    """Transform ambiguous follow-ups into standalone queries.

    "How does it handle clustering?"
    → "How does RAPTOR handle clustering in its hierarchical tree building?"
    """
```

---

## 3.2 SQL Chat (Text-to-SQL)

### Architecture

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│ Natural     │────▶│ Intent       │────▶│ Few-Shot     │
│ Language    │     │ Classifier   │     │ Retriever    │
└─────────────┘     └──────────────┘     └──────┬───────┘
                                                │
┌─────────────┐     ┌──────────────┐     ┌──────▼───────┐
│ Validated   │◀────│ Safety       │◀────│ SQL          │
│ Results     │     │ Validator    │     │ Generator    │
└─────────────┘     └──────────────┘     └──────────────┘
```

### Components

| Component | File | Purpose |
|-----------|------|---------|
| SQLChatService | `service.py` | Main orchestrator |
| Connection | `connection.py` | DB connection management |
| Schema | `schema.py` | Schema introspection |
| FewShotRetriever | `few_shot_retriever.py` | RAG for SQL examples (100K+ pairs) |
| IntentClassifier | `intent_classifier.py` | Query intent classification |
| ConfidenceScorer | `confidence_scorer.py` | SQL confidence scoring |

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/sql-chat/connections` | POST | Create connection |
| `/api/sql-chat/connections/test` | POST | Test connection |
| `/api/sql-chat/schema/{id}` | GET | Get schema |
| `/api/sql-chat/sessions` | POST | Create chat session |
| `/api/sql-chat/query/{session_id}` | POST | Execute query |
| `/api/sql-chat/query/{session_id}/stream` | POST | Streaming query |

### Safety Features

- Read-only enforcement (blocks DROP, DELETE, INSERT, etc.)
- Schema fingerprinting for change detection
- Query validation before execution
- Credential encryption (Fernet)

---

## 3.3 Analytics (Excel Dashboards)

### Flow

```
Upload Excel/CSV → Parse with pandas → Profile with ydata-profiling
                                               │
                        ┌──────────────────────┴──────────────────────┐
                        ▼                                              ▼
               LLM generates                                    Quality score
               dashboard config                                 + column stats
                        │
                        ▼
               Interactive dashboard
               (KPIs, charts, filters)
```

### Components

| Component | Purpose |
|-----------|---------|
| AnalyticsService | Session management, orchestration |
| DataProfiler | ydata-profiling integration |
| DashboardGenerator | LLM-powered config generation |
| DashboardModifier | NLP-based modifications |

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/analytics/upload` | POST | Upload file, create session |
| `/api/analytics/parse/{id}` | POST | Parse with pandas |
| `/api/analytics/profile/{id}` | POST | Run profiling |
| `/api/analytics/analyze/{id}` | POST | Generate dashboard |
| `/api/analytics/sessions/{id}/modify` | POST | NLP modification |
| `/api/analytics/sessions/{id}/undo` | POST | Undo last change |

### Frontend Components

| Component | Purpose |
|-----------|---------|
| `ExcelUploader.tsx` | Drag-and-drop upload |
| `DashboardView.tsx` | Main dashboard + PDF export |
| `ChartGrid.tsx` | Charts with cross-filtering |
| `KPICardGrid.tsx` | KPI metric cards |
| `FilterBar.tsx` | Interactive filters |

---

## 3.4 Content Studio

### Architecture

```
User Request → Content Retrieval → LLM Generation (Gemini Imagen)
                (top-k chunks)              │
                                            ▼
Gallery (DB) ← StudioManager ← Generated Image
```

### Generators

| Generator | Provider | Output |
|-----------|----------|--------|
| `InfographicGenerator` | Gemini Imagen | PNG/JPEG |
| `MindMapGenerator` | Gemini Imagen | PNG/JPEG |

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/studio/generators` | GET | List generators |
| `/api/studio/generate` | POST | Generate content |
| `/api/studio/gallery` | GET | List user's content |
| `/api/studio/content/{id}/file` | GET | Download file |

---

## 3.5 Web Content Ingestion

### Flow

```
Web Search (Firecrawl) → URL Preview (Jina) → User Confirmation
                                                      │
Invalidate Cache ← Embed & Store ← Scrape Full Content
```

### Providers

| Provider | Purpose | Config |
|----------|---------|--------|
| Firecrawl | Web search | `FIRECRAWL_API_KEY` |
| Jina Reader | URL scraping | `JINA_API_KEY` |

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/web/search` | POST | Search web |
| `/api/web/scrape-preview` | POST | Preview URL |
| `/api/notebooks/{id}/web-sources` | POST | Add URLs to notebook |

---

## 3.6 Vision & Image Analysis

### Providers

| Provider | Models |
|----------|--------|
| Gemini Vision | gemini-2.0-flash |
| OpenAI | gpt-4-vision-preview |

Images uploaded to notebooks are automatically analyzed and converted to searchable text chunks.

---

## 3.7 AI Document Transformations

### Types

| Type | Output |
|------|--------|
| `dense_summary` | Comprehensive summary |
| `key_insights` | Bullet points |
| `reflection_questions` | Study questions |

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/transformations/generate` | POST | Start job |
| `/api/transformations/status/{id}` | GET | Check status |
| `/api/transformations/result/{id}` | GET | Get result |

---

## 3.8 Agents Module

### Query Analyzer

```python
class QueryAnalyzer:
    def analyze(self, query: str) -> QueryAnalysis:
        return QueryAnalysis(
            intent="lookup|comparison|summary|exploration",
            complexity=0.0-1.0,
            entities=["extracted", "entities"],
            refinements=["suggested", "refinements"]
        )
```

### Document Analyzer

Routes queries to appropriate document sources based on content analysis.

---

## 3.9 Programmatic API Access

### Current: RAG Chat API (`/api/query`)

Enables scripting, automation, and integration with external systems.

```bash
# Simple query
curl -X POST http://localhost:7860/api/query \
  -H "X-API-Key: your-key" \
  -H "Content-Type: application/json" \
  -d '{"notebook_id": "uuid", "query": "What are the key findings?"}'

# With conversation memory
curl -X POST http://localhost:7860/api/query \
  -H "X-API-Key: your-key" \
  -d '{"notebook_id": "uuid", "query": "Tell me more", "session_id": "previous-session-id"}'
```

**Features**:
- API key authentication (`X-API-Key` header)
- Conversation memory via `session_id`
- Model/provider override per request
- Reranker control (`reranker_enabled`, `reranker_model`)
- Response formatting (`analytical`, `detailed`, `brief`)

**Use Cases**:
- Slack/Teams bot integration
- Scheduled report generation
- CI/CD documentation validation
- Custom dashboards pulling from RAG

### Future: Studio API (Planned)

Content Studio generation is currently UI-only. Potential API additions:

| Endpoint | Purpose |
|----------|---------|
| `POST /api/studio/infographic` | Generate infographic from notebook |
| `POST /api/studio/mindmap` | Generate mindmap |
| `GET /api/studio/gallery` | List generated content |

> See [Part 5: API Reference](#part-5-api-reference) for full `/api/query` documentation.

---

## 3.10 Quiz System (Adaptive Q&A)

Generate quizzes from notebook content with LLM-powered question generation and adaptive difficulty.

### Architecture

```
Quiz Creation (Admin)                      Quiz Taking (Public)
       │                                          │
       ▼                                          ▼
┌──────────────┐                         ┌───────────────┐
│ Select LLM   │                         │ Enter Name +  │
│ Model (opt)  │                         │ Email (opt)   │
└──────┬───────┘                         └───────┬───────┘
       │                                         │
       ▼                                         ▼
┌──────────────┐                         ┌───────────────┐
│ QuizService  │                         │ Session Check │──▶ Resume if exists
│ create_quiz()│                         │ (by email)    │
└──────┬───────┘                         └───────┬───────┘
       │                                         │
       ▼                                         ▼
┌──────────────┐    Generates on     ┌───────────────────┐
│ Store Quiz   │◀─────demand────────▶│ Adaptive Question │
│ Config (DB)  │                     │ Generation (LLM)  │
└──────────────┘                     └─────────┬─────────┘
                                               │
                                               ▼
                                     ┌───────────────────┐
                                     │ Difficulty Adjust │
                                     │ Easy ⇄ Medium ⇄ Hard│
                                     └───────────────────┘
```

### Key Features

| Feature | Description |
|---------|-------------|
| **Adaptive Difficulty** | Correct → harder, incorrect → easier |
| **Per-Quiz LLM Selection** | Choose model for question generation |
| **Email-Based Resumption** | Resume from any browser via email |
| **Shareable Links** | Public `/quiz/{id}` URLs (no auth required) |
| **Real-time Feedback** | Explanation after each answer |
| **Time Limits** | Optional per-quiz time constraints |

### Difficulty Modes

| Mode | Behavior |
|------|----------|
| `adaptive` | Starts medium, adjusts based on performance |
| `easy` | All questions use 6 context nodes |
| `medium` | All questions use 10 context nodes |
| `hard` | All questions use 15 context nodes |

### API Endpoints

**Admin Routes** (auth required):

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/quiz/create` | POST | Create quiz from notebook |
| `/api/quiz/list` | GET | List user's quizzes |
| `/api/quiz/{id}` | DELETE | Delete quiz |
| `/api/quiz/{id}/results` | GET | View attempt results |

**Public Routes** (no auth):

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/quiz/{id}/info` | GET | Get quiz metadata |
| `/api/quiz/{id}/start` | POST | Start attempt (name, email) |
| `/api/quiz/attempt/{id}/answer` | POST | Submit answer |

### Database Tables

| Table | Purpose |
|-------|---------|
| `quizzes` | Quiz config (notebook_id, title, difficulty_mode, llm_model) |
| `quiz_attempts` | Attempt tracking (taker_name, taker_email, score, answers JSONB) |

### Frontend Components

| Component | Path | Purpose |
|-----------|------|---------|
| `QuizConfigForm` | `Quiz/admin/` | Create quiz with LLM selection |
| `QuizDashboard` | `Quiz/admin/` | List quizzes, view stats |
| `QuizResultsTable` | `Quiz/admin/` | View attempt details |
| `QuizLanding` | `Quiz/taker/` | Enter name/email, start quiz |
| `QuizQuestion` | `Quiz/taker/` | Display question with timer |
| `QuizFeedback` | `Quiz/taker/` | Show correct answer + explanation |
| `QuizResults` | `Quiz/taker/` | Final score and review |

---

## 3.11 Document Management

Dedicated UI for managing notebook documents with upload, toggle, and delete capabilities.

### Features

| Feature | Description |
|---------|-------------|
| **Document Upload** | Drag-and-drop or click to upload |
| **Toggle Active** | Enable/disable documents for RAG queries |
| **Delete Documents** | Remove documents from notebook |
| **Web Sources** | Add content from web search/scraping |
| **Status Display** | Show RAPTOR build status, file type, size |

### Frontend Components

| Component | Path | Purpose |
|-----------|------|---------|
| `DocumentsPage` | `Documents/` | Main management view |
| `DocumentUploader` | `Documents/` | Drag-and-drop upload zone |
| `DocumentCard` | `Documents/` | Individual document with actions |

### Pages

| Page | Route | Purpose |
|------|-------|---------|
| `DocumentsLandingPage` | `/documents` | Prompt to select notebook |
| `DocumentsManagementPage` | `/documents/:notebookId` | Full document management |

### Document States

```
Upload → Processing → Embedding → RAPTOR Building → Ready
                                       │
                                       ▼
                              Active (in RAG) ⇄ Inactive (excluded)
```

---

# Part 4: Infrastructure

## 4.1 Authentication & RBAC

### Auth Flow

```
POST /login {username, password}
        │
        ▼
Validate bcrypt hash → Create Session + API Key → Set Cookie
```

### Roles

| Role | Capabilities |
|------|-------------|
| `admin` | Full access: user management, all notebooks |
| `user` | Own notebooks, own connections |

### Access Levels

```python
class AccessLevel(Enum):
    VIEWER = "viewer"    # Read-only
    EDITOR = "editor"    # Read + write
    OWNER = "owner"      # Full control
```

When `RBAC_STRICT_MODE=true`, all operations validate access levels.

---

## 4.2 Background Workers

### RAPTORWorker

Builds hierarchical summary trees asynchronously:
- Triggered on document upload
- Updates `notebook_sources.raptor_status`: pending → building → complete

### TransformationWorker

Processes document transformation jobs in background.

---

## 4.3 Observability & Health Monitoring

### Health Check

`GET /health` returns:

```json
{
  "status": "healthy|degraded|unhealthy",
  "components": {
    "database": {"status": "healthy"},
    "ollama": {"status": "healthy", "models_available": 5},
    "vector_store": {"status": "healthy", "document_count": 1234}
  },
  "system": {
    "cpu_percent": 25.5,
    "memory_percent": 45.2
  }
}
```

### QueryLogger & Admin Token Metrics

Token usage tracking and cost estimation per model with admin dashboard visualization.

**Token Metrics Dashboard** (`/api/admin/metrics/tokens`):

| Metric | Description |
|--------|-------------|
| **Total Tokens** | Sum of input + output tokens |
| **Total Cost** | Estimated cost based on model pricing |
| **Total Queries** | Number of queries in time period |
| **Avg Response Time** | Average response time in ms |

**Breakdowns**:
- **By Model**: Token/cost/query distribution per LLM model
- **By User**: Token/cost/query distribution per user
- **By Day**: Daily usage trend (bar chart)

**API Endpoint**:
```bash
GET /api/admin/metrics/tokens?days=30
# Returns: summary, by_model, by_user, by_day
```

**Frontend**: Admin Dashboard → "Usage Metrics" tab

---

# Part 5: API Reference

## 5.1 Programmatic API (`/api/query`)

### Authentication

```bash
curl -H "X-API-Key: your-api-key" http://localhost:7860/api/query
```

### Request

```json
POST /api/query
{
  "notebook_id": "uuid",           // Required
  "query": "What are the findings?", // Required

  // Optional - Memory
  "session_id": "uuid",            // Enables conversation memory
  "max_history": 5,

  // Optional - Response
  "include_sources": true,
  "max_sources": 6,
  "response_format": "analytical", // default|detailed|analytical|brief

  // Optional - Model/Retrieval
  "model": "gpt-4.1",
  "reranker_enabled": true,
  "reranker_model": "large",       // xsmall|base|large
  "skip_raptor": true
}
```

### Response

```json
{
  "success": true,
  "response": "LLM response...",
  "session_id": "uuid",
  "sources": [{"filename": "doc.pdf", "snippet": "...", "score": 0.89}],
  "metadata": {
    "execution_time_ms": 1234,
    "model": "gpt-4.1",
    "timings": { ... }
  }
}
```

### OpenAPI Specification

Full docs: `docs/api/openapi.yaml`

Import into [Swagger Editor](https://editor.swagger.io/) for interactive documentation.

---

## 5.2 SSE Streaming Protocol

### Event Types

| Type | Payload | Description |
|------|---------|-------------|
| `start` | `{}` | Stream started |
| `content` | `{"content": "text"}` | Incremental text |
| `sources` | `{"sources": [...]}` | Retrieved sources |
| `metadata` | `{"model": "..."}` | Response metadata |
| `done` | `{}` | Stream complete |

### Client Example

```javascript
const eventSource = new EventSource('/api/v2/chat/stream');
eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'content') appendToResponse(data.content);
  if (data.type === 'done') eventSource.close();
};
```

---

## 5.3 API Error Format

### Standard Response

```json
{
  "success": false,
  "error": "Human-readable message"
}
```

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| 400 | Bad Request (validation) |
| 401 | Unauthorized |
| 403 | Forbidden (RBAC) |
| 404 | Not Found |
| 429 | Rate Limited |
| 500 | Internal Error |
| 503 | Service Unavailable |

---

# Part 6: Operations

## 6.1 Common Commands

```bash
# Development (macOS/Local)
./scripts/sh/dev.sh local              # Start Flask on :7860
./scripts/sh/dev.sh status             # Check what's running
./scripts/sh/dev.sh stop               # Stop everything

# Production (Linux)
./scripts/sh/prod.sh start             # Start in background with logging
./scripts/sh/prod.sh stop              # Graceful shutdown
./scripts/sh/prod.sh restart           # Stop + Start
./scripts/sh/prod.sh status            # PID, uptime, memory, PostgreSQL status
./scripts/sh/prod.sh logs              # Follow app + error logs
./scripts/sh/prod.sh health            # HTTP health check
./scripts/sh/prod.sh rotate            # Rotate log files (keeps 7 days)

# Frontend
cd frontend && npm run dev  # Dev server on :3000
npm run build               # Production build

# Database
docker compose exec dbnotebook alembic upgrade head
docker compose exec dbnotebook alembic revision -m "description"

# Unit/Integration Tests
pytest tests/
pytest -v -x                # Verbose, stop on first failure

# Load Testing (requires: pip install aiohttp)
python tests/simple_load_test.py           # 100 concurrent users (local)
python tests/simple_load_test.py 50        # Custom user count
python scripts/load_test_query_api.py      # Cloud load test (configurable)
```

### Load Testing Details

**Simple Load Test** (`tests/simple_load_test.py`):
- 100 concurrent users, 1 request each (default)
- Uses `/api/query` endpoint with API key auth
- Reports: success rate, latency (min/max/avg/P95), throughput (req/s)

**Cloud Load Test** (`scripts/load_test_query_api.py`):
- 100 concurrent users × 5 queries each = 500 total requests
- Tests conversation memory (session continuity)
- Auto-fetches API key and notebook ID
- Reports: P50/P90/P95/P99 latencies, character throughput, error breakdown

```bash
# Sample output from simple_load_test.py
LOAD TEST: 100 concurrent users, 1 request each
Results Summary:
  Total time: 45.23s
  Successes: 98/100 (98.0%)
  Failures: 2

Latency (successful requests):
  Min: 1.24s
  Max: 42.18s
  Avg: 8.76s
  P95: 38.42s

Throughput: 2.17 req/s
```

---

## 6.2 Environment Variables

### API Keys

| Variable | Provider |
|----------|----------|
| `OPENAI_API_KEY` | OpenAI (GPT-4, embeddings) |
| `ANTHROPIC_API_KEY` | Anthropic (Claude) |
| `GOOGLE_API_KEY` | Google (Gemini, Imagen) |
| `GROQ_API_KEY` | Groq (fast Llama) |
| `FIRECRAWL_API_KEY` | Web search |
| `JINA_API_KEY` | Web scraping |

### LLM Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_PROVIDER` | `ollama` | groq/openai/anthropic/gemini/ollama |
| `LLM_MODEL` | `llama3.1:latest` | Model name |
| `EMBEDDING_PROVIDER` | `openai` | openai/huggingface |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | Embedding model |
| `CONTEXT_WINDOW` | `128000` | Max context tokens |
| `CHAT_TOKEN_LIMIT` | `32000` | Chat memory buffer |

### Database

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | - | Full connection string |
| `POSTGRES_HOST` | `localhost` | DB host |
| `POSTGRES_PORT` | `5432` | DB port |
| `POSTGRES_DB` | `dbnotebook_dev` | Database name |
| `POSTGRES_USER` | `dbnotebook` | Username |
| `POSTGRES_PASSWORD` | `dbnotebook` | Password |
| `PGVECTOR_EMBED_DIM` | `1536` | Vector dimensions |

### Retrieval

| Variable | Default | Description |
|----------|---------|-------------|
| `RETRIEVAL_STRATEGY` | `hybrid` | hybrid/semantic/keyword |
| `RERANKER_MODEL` | `large` | xsmall/base/large |
| `DISABLE_RERANKER` | `false` | Skip reranking |

### Authentication

| Variable | Default | Description |
|----------|---------|-------------|
| `FLASK_SECRET_KEY` | - | **Required** for sessions |
| `API_KEY` | - | Fallback API key |
| `RBAC_STRICT_MODE` | `false` | Enforce access control |

> Generate secret key: `python -c "import secrets; print(secrets.token_hex(32))"`

### Vision & Images

| Variable | Default |
|----------|---------|
| `VISION_PROVIDER` | `gemini` |
| `IMAGE_GENERATION_PROVIDER` | `gemini` |
| `GEMINI_IMAGE_MODEL` | `gemini-3-pro-image-preview` |

### SQL Chat

| Variable | Default |
|----------|---------|
| `SQL_CHAT_ENCRYPTION_KEY` | - |
| `SQL_CHAT_SKIP_READONLY_CHECK` | `false` |
| `FEW_SHOT_MAX_EXAMPLES` | `100000` |

### Ollama

| Variable | Default |
|----------|---------|
| `OLLAMA_HOST` | `localhost` |
| `OLLAMA_PORT` | `11434` |

---

## 6.3 Troubleshooting

| Problem | First Check | Second Check |
|---------|-------------|--------------|
| No results returned | Node cache (invalidate) | Embedding dimension |
| Slow first query | Cold start | Model not downloaded |
| Rate limit errors | Provider limits | Backoff implementation |
| Auth not working | `FLASK_SECRET_KEY` set? | Session cookies |
| SQL Chat fails | Connection credentials | Read-only enforcement |
| Frontend not updating | `npm run build` | Browser cache |
| Quiz LLM model fails | Check provider API key | Fallback to default LLM |
| Quiz session not resuming | Email must match exactly | Check `taker_email` in DB |

---

## 6.4 Deployment

### Linux Production (`scripts/sh/prod.sh`)

The `scripts/sh/prod.sh` script manages production deployments on Linux servers:

```bash
# First-time setup
python3 -m venv venv
pip install -r requirements.txt
cp .env.example .env && nano .env  # Configure

# Start production
./scripts/sh/prod.sh start
# → Validates .env exists
# → Checks PostgreSQL is reachable
# → Activates venv
# → Runs Alembic migrations
# → Starts Flask with --with-threads
# → Logs to logs/app.log and logs/error.log

# Management
./scripts/sh/prod.sh status   # Shows PID, uptime, memory usage
./scripts/sh/prod.sh logs     # tail -f both log files
./scripts/sh/prod.sh health   # curl /api/auth/me health check
./scripts/sh/prod.sh rotate   # Rotate logs, keep 7 days, gzip old
```

**Key Features**:
- PID file tracking (`.dbnotebook.pid`)
- Automatic `host.docker.internal` → `localhost` replacement
- Graceful shutdown (10s timeout before force kill)
- Log rotation with compression

### Docker Production

```bash
./scripts/sh/dev.sh docker               # Build + start on :7007
docker compose up -d --build  # Alternative
```

### Deployment Checklist

- [ ] `.env` has all required secrets
- [ ] `FLASK_SECRET_KEY` is set (prevents logout on restart)
- [ ] Database migrations up to date (`alembic upgrade head`)
- [ ] `PGVECTOR_EMBED_DIM` matches embedding model (1536 for OpenAI, 768 for nomic)
- [ ] Frontend built (`cd frontend && npm run build`)
- [ ] CORS configured for production domain
- [ ] Health check responds: `curl http://localhost:7860/api/auth/me`
- [ ] Load test passes: `python tests/simple_load_test.py 10`

---

# Part 7: Engineering Decisions & Lessons

## 7.1 Key Decisions

### pgvector Instead of Pinecone/Weaviate

**Why**: One database for everything—no sync issues, simpler ops, $0 extra cost.

**Trade-off**: Slightly less optimized vector ops than specialized DBs.

### Hybrid Retrieval (BM25 + Semantic)

**Why**: Semantic finds concepts, BM25 finds exact terms. Combined gives best results.

**Smart routing**: Small indexes (≤6 nodes) use simple vector search. Large indexes use full pipeline.

### RAPTOR Hierarchical Summaries

**Why**: Documents have structure. Flat retrieval misses the forest for the trees.

**Implementation**: Background worker builds trees (expensive), users don't wait.

### Multi-User Architecture

**Pattern**:
```python
# UI (single-user): Global state OK
pipeline.switch_notebook(notebook_id)
response = pipeline.query(question)

# API (multi-user): Stateless pattern required
response = stateless_query(notebook_id, user_id, question)
```

---

## 7.2 Lessons Learned

### The Stale Cache Bug

**Bug**: Web search documents weren't being retrieved.

**Cause**: Node cache wasn't invalidated after storing new embeddings.

**Fix**: `pipeline.invalidate_node_cache(notebook_id)` after web content ingestion.

**Lesson**: Whenever you add/modify data, ask: "What caches need invalidating?"

### The Reranker Config Leak

**Bug**: Per-request reranker settings affected other users.

**Cause**: Global config modified without restoration.

**Fix**: Save/restore in try/finally block.

**Lesson**: Global state in multi-user systems is a landmine.

### Cold Start Mystery

**Bug**: First query took 30+ seconds.

**Cause**: Lazy-loading embedding models.

**Fix**: Eager initialization at startup.

**Lesson**: In user-facing services, pay the cost at startup.

### Groq Rate Limit Avalanche

**Bug**: 429 errors under load.

**Fix**: Exponential backoff with jitter.

**Lesson**: Build backoff into provider wrappers from day one.

### Follow-Up Query Confusion

**Bug**: "Tell me more" returned irrelevant results.

**Cause**: Using ambiguous query directly for retrieval.

**Fix**: Query expansion before retrieval.

**Lesson**: Retrieval sees what you give it. Expand ambiguous queries first.

### The Reverted Optimization (v8.5.x)

**Change**: Added fast stateless chat path for UI (`/chat` endpoint).

**Reverted**: Broke something downstream—had to revert.

**Lesson**: "Optimization" that changes behavior isn't optimization. Test the full flow before merging performance changes.

### User Deletion Cascade (v8.5.0)

**Bug**: Deleting a user left orphan records, broke queries.

**Cause**: Missing `ON DELETE CASCADE` on foreign keys.

**Fix**: Added proper FK cascades in migration.

**Lesson**: Design your delete strategy upfront. Cascade vs. restrict vs. set null—decide early.

### Per-Request Config Override (v9.1.1)

**Problem**: API users wanted to override `DISABLE_RERANKER` env var per request.

**Challenge**: Env vars are global; API requests are per-user.

**Solution**: API parameter takes precedence over env var when explicitly set.

```python
# Pattern: API param > env var > default
use_reranker = request.get('reranker_enabled')
if use_reranker is None:
    use_reranker = not os.getenv('DISABLE_RERANKER', 'false').lower() == 'true'
```

**Lesson**: Design config hierarchy: request > user > env > default.

### Thread-Safe Node Cache (v8.1.0)

**Bug**: Concurrent API requests corrupted cache, returned wrong notebook's content.

**Cause**: Global dict without locking in multi-threaded Flask.

**Fix**: Thread-local storage + per-notebook cache keys.

**Lesson**: If it's mutable and shared, it needs synchronization. Period.

### Cold Start via Lazy Retriever (v8.5.4)

**Bug**: First query took 30s because retriever was rebuilt on every request.

**Cause**: `RouterRetriever` dynamically choosing retriever type.

**Fix**: Use `TwoStageRetriever` directly—no runtime decision overhead.

**Lesson**: Dynamic dispatch is elegant but expensive. When you know what you need, instantiate it directly.

### Anti-Hallucination for Follow-ups (v8.5.1)

**Bug**: "Tell me more about section 3" hallucinated content.

**Cause**: LLM had no context about what "section 3" referred to.

**Fix**: Inject previous Q&A into context before retrieval + generation.

**Lesson**: Follow-up queries need conversational context, not just the literal query string.

### Node Cache vs pgvector Persistence (v1.1)

**Bug**: Uploaded documents disappeared after restart.

**Cause**: In-memory node cache wasn't synced with pgvector.

**Fix**: Disabled node cache entirely—pgvector is the source of truth.

**Lesson**: Don't cache what your database already stores. Pick one persistence layer.

### Docker + Ollama Architecture (v1.1)

**Bug**: Container crashed trying to start Ollama inside.

**Cause**: Ollama needs GPU access, doesn't belong inside app container.

**Fix**: Ollama runs on host; container connects via `OLLAMA_HOST=host.docker.internal`.

**Lesson**: Containers should do one thing. GPU services run separately.

### GitHub Actions Disk Space (v1.1)

**Bug**: Docker build failed with "no space left on device".

**Cause**: GitHub Actions runners have ~14GB; Docker layers + HuggingFace models exceeded it.

**Fix**: Added `docker system prune` and free disk space step before build.

**Lesson**: CI runners have limited disk. Clean up before large builds.

### Multi-Stage Docker for Frontend (v1.1)

**Bug**: Docker image missing frontend assets.

**Cause**: `npm run build` wasn't in Dockerfile.

**Fix**: Added separate build stage: `npm install && npm run build`, then copy `dist/`.

```dockerfile
# Build frontend
FROM node:20 AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Final image
FROM python:3.11
COPY --from=frontend /app/frontend/dist /app/static
```

**Lesson**: Frontend and backend have different build toolchains. Multi-stage Docker keeps them separate.

### HuggingFace Models in Docker (v5.0)

**Bug**: Container startup took 10+ minutes downloading models.

**Cause**: Models downloaded at runtime, not baked into image.

**Fix**: Download during `docker build`, not at runtime.

```dockerfile
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('mixedbread-ai/mxbai-rerank-base-v1')"
```

**Lesson**: Bake large dependencies into images. Runtime downloads are unreliable and slow.

### Duplicate Document Handling (v5.0)

**Bug**: Re-uploading a document failed silently.

**Cause**: MD5 duplicate check threw exception, stopped entire ingestion.

**Fix**: Log warning, skip duplicate, continue with remaining documents.

**Lesson**: Batch operations should be resilient. One failure shouldn't abort the batch.

---

## 7.3 Engineering Patterns

### Service Layer

```python
class SomeService(BaseService):
    def __init__(self, pipeline, db_manager, notebook_manager):
        super().__init__(pipeline, db_manager, notebook_manager)
```

### Stateless Query Pattern

```python
def stateless_query(notebook_id, user_id, query):
    """Pure function - no side effects on global state."""
    nodes = get_cached_nodes(notebook_id)  # Thread-safe
    results = retrieve(nodes, query)
    response = generate(results, query)
    save_to_db(user_id, query, response)
    return response
```

### SSE Streaming

```python
def stream_response():
    def generate():
        yield f"data: {json.dumps({'type': 'start'})}\n\n"
        for chunk in llm.stream(prompt):
            yield f"data: {json.dumps({'type': 'content', 'content': chunk})}\n\n"
        yield f"data: {json.dumps({'type': 'done'})}\n\n"
    return Response(generate(), mimetype='text/event-stream')
```

### Background Workers

```python
class Worker:
    def __init__(self):
        self.queue = Queue()
        self.thread = Thread(target=self._process, daemon=True)
        self.thread.start()

    def submit(self, job):
        self.queue.put(job)  # Returns immediately
```

---

# Final Thoughts

DBNotebook evolved from a simple RAG chatbot into a multi-modal knowledge assistant. Key takeaways:

1. **Start simple, add complexity when needed** - Pure vector search → hybrid → RAPTOR → reranking

2. **Caches are necessary evil** - Document every cache, its TTL, and invalidation triggers

3. **Multi-user is hard** - Stateless patterns prevent global state bugs

4. **LLMs are probabilistic** - Build in confidence scoring and fallbacks

5. **Best code is code you don't write** - LlamaIndex, pgvector did the heavy lifting

---

*Last updated: February 1, 2026*
