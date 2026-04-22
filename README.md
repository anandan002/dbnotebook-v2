# DBNotebook

A notebook-based RAG (Retrieval-Augmented Generation) system with multimodal capabilities. Organize documents into notebooks, chat with your data using multiple AI providers, and generate visual content like infographics.

**Orchestrated by Bharath D**
**Developed by Claude (Anthropic)**

---

## Quick Start

```bash
# Clone the repository
git clone https://github.com/beedev/dbnotebook.git
cd dbnotebook

# Run the startup script (macOS/Linux)
bash ./scripts/sh/start.sh

# Open browser at http://localhost:7860
```

Windows (PowerShell):

```powershell
py -3.11 -m venv venv
.\venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
.\venv\Scripts\python.exe -m dbnotebook --host 0.0.0.0 --port 7860
```

Cross-platform deployment and service setup:
[docs/deployment/CROSS_PLATFORM_DEPLOYMENT.md](docs/deployment/CROSS_PLATFORM_DEPLOYMENT.md)

---

## Features

### Notebook Management
- Create and organize notebooks for different topics/projects
- Upload documents (PDF, DOCX, TXT, MD, images)
- Chat with documents using RAG retrieval
- Persistent conversation history

### Multi-Provider AI
- **LLM Providers**: Ollama (local), OpenAI, Anthropic Claude, Google Gemini
- **Embedding**: HuggingFace (nomic-embed-text-v1.5), OpenAI
- **Vision**: GPT-4V, Gemini Vision for image analysis
- **Image Generation**: Gemini Imagen for infographics

### Content Studio
- Generate infographics from notebook content
- Brand extraction from reference images (colors, style)
- Mind map generation
- Gallery of generated content

### Web Content Ingestion
- Add web pages to notebooks via URL
- Automatic content extraction and chunking

### Modern Stack
- **Backend**: Flask + PostgreSQL + pgvector
- **Frontend**: React + TypeScript + Tailwind CSS
- **Vector Store**: pgvector for semantic search
- **Hybrid Retrieval**: BM25 + vector search with reranking

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    React Frontend                        │
│         (TypeScript + Tailwind + Deep Space Theme)       │
└─────────────────────────┬───────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────┐
│                     Flask API                            │
│    /api/chat  /api/notebooks  /api/studio  /api/vision   │
└─────────────────────────┬───────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────┐
│                   Core Services                          │
├──────────────┬──────────────┬──────────────┬────────────┤
│  Notebook    │  Conversation │   Content    │   Vision   │
│  Manager     │    Store      │   Studio     │  Manager   │
└──────────────┴──────────────┴──────────────┴────────────┘
                          │
┌─────────────────────────▼───────────────────────────────┐
│              PostgreSQL + pgvector                       │
│     (notebooks, documents, embeddings, conversations)    │
└─────────────────────────────────────────────────────────┘
```

---

## Configuration

Create a `.env` file:

```bash
# Database
DATABASE_URL=postgresql://user:pass@localhost:5433/dbnotebook

# LLM Providers (add keys for providers you want to use)
OPENAI_API_KEY=your_key
ANTHROPIC_API_KEY=your_key
GOOGLE_API_KEY=your_key

# Default Models
DEFAULT_LLM_MODEL=llama3.1:latest
DEFAULT_EMBEDDING_MODEL=nomic-ai/nomic-embed-text-v1.5
```

See `.env.example` for all configuration options.

---

## Development

```bash
# Install dependencies
pip install -e .

# Run with hot reload
python -m dbnotebook --host localhost --port 7860

# Frontend development
cd frontend
npm install
npm run dev
```

---

## Docker

```bash
docker compose up --build
```

---

## License

Apache 2.0 License

