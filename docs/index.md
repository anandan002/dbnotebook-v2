# DBNotebook

**A multimodal RAG system with NotebookLM-style document organization**

---

## What is DBNotebook?

DBNotebook is an intelligent document assistant that lets you organize documents into notebooks and have natural conversations with your data. Think of it as having a research assistant who has read everything you've uploaded and can answer questions with source citations.

<div class="grid cards" markdown>

-   :material-chat-processing:{ .lg .middle } **RAG Chat**

    ---

    Ask questions about your documents and get accurate, context-aware answers with source citations

    [:octicons-arrow-right-24: Learn more](features/rag-chat.md)

-   :material-database-search:{ .lg .middle } **SQL Chat**

    ---

    Connect to databases and query them using natural language - no SQL knowledge required

    [:octicons-arrow-right-24: Learn more](features/sql-chat.md)

-   :material-chart-box:{ .lg .middle } **Excel Analytics**

    ---

    Upload Excel/CSV files and get AI-generated dashboards with KPIs, charts, and filters

    [:octicons-arrow-right-24: Learn more](features/excel-analytics.md)

-   :material-image-edit:{ .lg .middle } **Content Studio**

    ---

    Generate infographics and mind maps from your documents for presentations

    [:octicons-arrow-right-24: Learn more](features/content-studio.md)

</div>

---

## Key Features

### Smart Document Retrieval

- **Hybrid Search**: Combines BM25 keyword matching with vector semantic search
- **RAPTOR Hierarchical Retrieval**: Tree-based retrieval for better summary and detail queries
- **Reranking**: Cross-encoder reranking for precise results
- **Query Expansion**: Automatically generates multiple query variations

### Multi-Provider AI Support

| Provider | Models | Use Case |
|----------|--------|----------|
| **Ollama** | Llama 3.1, Qwen, Mistral | Local/private deployment |
| **Groq** | Llama 4, Llama 3.3 | Ultra-fast inference (300-800 tok/s) |
| **OpenAI** | GPT-4.1, GPT-4o | Best quality responses |
| **Anthropic** | Claude 3.5 Sonnet | Long context, nuanced responses |
| **Google** | Gemini 2.0 | Multimodal, image generation |

### Document Support

- **Text**: PDF, DOCX, PPTX, TXT, Markdown, EPUB
- **Data**: Excel (XLSX, XLS), CSV
- **Images**: PNG, JPG, WebP (analyzed via Vision AI)
- **Web**: Import web pages directly via URL

### Enterprise Ready

- Multi-user authentication with RBAC
- API key-based programmatic access
- Docker deployment with single command
- PostgreSQL + pgvector for production scale

---

## Quick Start

```bash
# Clone and start
git clone https://github.com/beedev/dbnotebook-v2.git
cd dbnotebook-v2
bash ./scripts/sh/dev.sh local

# Open browser
open http://localhost:7860
```

Default login: `admin` / `admin123`

[:octicons-arrow-right-24: Full installation guide](getting-started/installation.md)
[:octicons-arrow-right-24: Cross-platform deployment guide](deployment/CROSS_PLATFORM_DEPLOYMENT.md)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     React Frontend                           │
│                   (Vite + Tailwind CSS)                     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Flask REST API                            │
│              (Authentication, Routes, SSE)                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   LocalRAGPipeline                           │
│    ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│    │  Ingestion  │  │  Retrieval  │  │  Chat Engine│       │
│    └─────────────┘  └─────────────┘  └─────────────┘       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                PostgreSQL + pgvector                         │
│           (Documents, Embeddings, Conversations)             │
└─────────────────────────────────────────────────────────────┘
```

[:octicons-arrow-right-24: Full architecture documentation](ARCHITECTURE.md)

---

## API Access

DBNotebook provides a REST API for programmatic access:

```bash
curl -X POST http://localhost:7860/api/query \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "notebook_id": "your-notebook-uuid",
    "query": "What are the key findings?"
  }'
```

[:octicons-arrow-right-24: API documentation](api/API_GUIDE.md)

---

## License

DBNotebook is developed by Bharath D with Claude (Anthropic).
