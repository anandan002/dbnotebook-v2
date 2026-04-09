# Changelog

All notable changes to DBNotebook are documented here.

---

## [9.1.1] - 2025-01

### Added
- Server deployment guide for production Linux deployments
- `scripts/sh/prod.sh` script for Linux production deployments
- Updated OpenAPI specification

### Fixed
- TwoStageRetriever selection bug
- Optimized reranker model loading

### Changed
- Cleaned up documentation folder structure
- Removed uploads directory from version control

---

## [9.1.0] - 2025-01

### Fixed
- TwoStageRetriever selection logic
- Reranker model optimization for faster inference

---

## [9.0.0] - 2025-01

### Added
- Per-request reranker control via API
- Query API enhancements for scripting/automation
- RAPTOR intelligence in `/api/query` endpoint

### Changed
- Major configuration cleanup
- Unified retrieval settings across features
- Improved Query API response format

### Fixed
- Cold start delay eliminated by using TwoStageRetriever directly
- Query expansion for follow-up questions

---

## [8.5.4] - 2025-01

### Fixed
- Eliminated cold start delay by using TwoStageRetriever directly
- Improved first-query performance

---

## [8.5.3] - 2025-01

### Fixed
- Query expansion wiring for follow-up questions in Query API

---

## [8.5.2] - 2025-01

### Fixed
- Groq LLM wrapper compatibility issues
- Reranker performance optimizations

---

## [8.5.1] - 2025-01

### Fixed
- Anti-hallucination measures for follow-up queries
- Docker Groq dependency issues

---

## [8.5.0] - 2025-01

### Added
- Groq provider for ultra-fast LLM inference (300-800 tok/s)
- Model selection in Query API
- Enhanced load testing scripts

### Fixed
- API key display issues
- User deletion cascade behavior
- Groq rate limit handling with exponential backoff

---

## [8.3.0] - 2024-12

### Added
- GPT-4.1 support for SQL Chat
- Enhanced load testing capabilities

### Changed
- Improved SQL Chat schema filtering using RAG

---

## [2.0.0] - 2024-12

### Added
- **Multi-user authentication system**
  - Login/logout with bcrypt password hashing
  - API key generation for programmatic access
  - Role-based access control (RBAC)
- **Admin UI**
  - User management (create, delete, list)
  - Role assignment
- **V2 Chat API** with multi-user support
- Per-stage timing instrumentation
- PDF table extraction improvements

### Changed
- Gunicorn deployment support
- Async operation fixes
- Thread-safe cache implementation

### Security
- Session management with Flask-Secret-Key
- API key authentication for /api/query

---

## [1.5.0] - 2024-11

### Added
- **SQL Chat** - Natural language to SQL
  - Multi-database support (PostgreSQL, MySQL, SQLite)
  - Few-shot learning with 100K+ SQL examples
  - Confidence scoring and validation
  - Schema dictionary generation
- **Excel Analytics**
  - AI-generated dashboards
  - NLP-based dashboard modification
  - Interactive cross-filtering
  - Data profiling with quality scores

### Changed
- Switched to OpenAI embeddings by default
- Improved Docker build optimization

---

## [1.4.0] - 2024-10

### Added
- **RAPTOR hierarchical retrieval**
  - Tree-based document summarization
  - Multi-level retrieval (summary vs detail queries)
  - Automatic keyword-based routing
- **Content Studio**
  - Infographic generation with Gemini Imagen
  - Mind map creation
  - Brand extraction from reference images

### Changed
- Enhanced hybrid retrieval with query fusion
- Improved reranker integration

---

## [1.3.0] - 2024-09

### Added
- **Web ingestion**
  - Firecrawl web search integration
  - Jina Reader for page scraping
  - URL import with content extraction
- **Vision providers**
  - Gemini Vision support
  - OpenAI GPT-4V support
  - Image understanding in documents

### Changed
- Plugin architecture for providers
- Configuration via YAML files

---

## [1.2.0] - 2024-08

### Added
- **Hybrid retrieval**
  - BM25 + Vector fusion
  - Query expansion (multi-query retrieval)
  - Reranking with mixedbread-ai models
- **AI Transformations**
  - Document summarization
  - Key insights extraction
  - Reflection questions

### Changed
- Retrieval strategy selection via environment
- Improved chunking with sentence splitter

---

## [1.1.0] - 2024-07

### Added
- **Multi-provider LLM support**
  - Ollama (local)
  - OpenAI
  - Anthropic Claude
  - Google Gemini
- Streaming responses (SSE)
- Conversation persistence

### Changed
- Configurable context window
- Token limit management

---

## [1.0.0] - 2024-06

### Added
- Initial release
- **NotebookLM-style document organization**
  - Notebook-based document collections
  - Source management (active/inactive toggle)
- **RAG Chat**
  - Vector similarity search
  - PostgreSQL + pgvector backend
- **Document processing**
  - PDF, DOCX, TXT, MD support
  - Automatic chunking and embedding
- **React frontend**
  - Document upload
  - Chat interface
  - Source highlighting

---

## Migration Notes

### Upgrading to 9.0.0

Configuration files have been reorganized:

```bash
# Run migrations
alembic upgrade head

# Update your .env if using custom configs
# Old: retriever_weights in multiple places
# New: Unified in config/ingestion.yaml
```

### Upgrading to 2.0.0

Multi-user authentication requires database migration:

```bash
# Run migrations
alembic upgrade head

# Default credentials
# Username: admin
# Password: admin123 (change immediately!)
```

### Upgrading to 1.5.0

SQL Chat requires an encryption key:

```bash
# Generate a Fernet key
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

# Add to .env
SQL_CHAT_ENCRYPTION_KEY=your-generated-key
```
