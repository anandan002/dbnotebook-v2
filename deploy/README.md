# DBNotebook - Deployment Guide

Multimodal RAG Sales Enablement System with NotebookLM-style document organization.

## Prerequisites

- **Docker Desktop** (macOS/Windows) or Docker Engine + Compose (Linux)
- **GitHub account** with package access (provided by admin)
- **Ollama** running on host (optional - for local LLM inference)

## Quick Start

### Option A: App Container + Local PostgreSQL

Use this when PostgreSQL runs on the same machine as Docker.

PostgreSQL prerequisites:

- PostgreSQL is listening on port `5432`.
- Database `dbnotebook_dev` exists.
- The `pgvector` extension is installed and can be created by the configured user.
- Host PostgreSQL allows password connections from Docker bridge clients.

Configure the local env file:

```bash
cd deploy
cp env.host-postgres.example .env.host-postgres
# Edit .env.host-postgres with database credentials.
# Provider API keys and model settings are loaded from ../.env.
```

Confirm deployment config files are present:

```bash
ls config/dbnotebook.yaml config/models.yaml
```

Start DBNotebook:

```bash
docker compose -f docker-compose.host-postgres.yml up -d --build
```

Rerun DBNotebook after code, config, or `.env` changes:

```bash
docker compose -f docker-compose.host-postgres.yml up -d --build --force-recreate dbnotebook
```

Access DBNotebook through Nginx at `http://20.244.34.144/dbnotebook/`.
For direct container debugging, the app is published on `http://localhost:7007/`;
API routes on the direct port do not include the `/dbnotebook` prefix.

When Nginx is installed on the host, copy `deploy/nginx/dbnotebook.conf` into
`/etc/nginx/sites-available/dbnotebook` and reload Nginx to serve the app at
`http://20.244.34.144/dbnotebook`.

If the server already includes `/etc/nginx/site-routes-enabled/*.conf` inside
the public `20.244.34.144` server block, install `deploy/nginx/dbnotebook-route.conf`
there instead.

Operational commands:

```bash
# Validate compose configuration
docker compose -f docker-compose.host-postgres.yml config

# View app logs
docker compose -f docker-compose.host-postgres.yml logs -f dbnotebook

# Check container status
docker ps --filter name=dbnotebook

# Stop app container
docker compose -f docker-compose.host-postgres.yml down

# Health checks
curl http://localhost:7007/api/health
curl http://20.244.34.144/dbnotebook/api/health
```

Notes:

- The app reaches host PostgreSQL through `host.docker.internal`.
- The Docker image builds the React frontend with `/dbnotebook` as the base path.
- URL-encode special characters in the database password inside `DATABASE_URL`.
- Automatic SQL Chat few-shot dataset loading is disabled by default for this deployment.
- Do not commit `.env.host-postgres`; it is intentionally ignored by Git.

### Option B: Bundled Docker PostgreSQL

### 1. Login to GitHub Container Registry

```bash
# Using GitHub CLI (recommended)
gh auth token | docker login ghcr.io -u YOUR_USERNAME --password-stdin

# Or using personal access token
echo $GITHUB_TOKEN | docker login ghcr.io -u YOUR_USERNAME --password-stdin
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your API keys
```

### 3. Start Services

```bash
docker compose up -d
```

### 4. Access

Open http://localhost:7860

## Configuration

Edit `.env` file with your settings:

```bash
# LLM Provider (ollama, openai, anthropic, gemini)
LLM_PROVIDER=ollama
LLM_MODEL=llama3.1:latest

# Embedding Provider
EMBEDDING_PROVIDER=huggingface
EMBEDDING_MODEL=nomic-ai/nomic-embed-text-v1.5

# Retrieval Strategy
RETRIEVAL_STRATEGY=hybrid

# API Keys (as needed for your provider)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=...

# Image Generation (for Content Studio)
IMAGE_GENERATION_PROVIDER=gemini
GEMINI_IMAGE_MODEL=imagen-4.0-generate-001

# Vision Processing
VISION_PROVIDER=gemini

# Web Search (optional)
FIRECRAWL_API_KEY=...
```

## Services

For `docker-compose.host-postgres.yml`:

| Service | Port | Description |
|---------|------|-------------|
| dbnotebook | 7860 | Web UI & API |
| host PostgreSQL | 5432 | External local PostgreSQL + pgvector |

For `docker-compose.yml`:

| Service | Port | Description |
|---------|------|-------------|
| dbnotebook | 7860 | Web UI & API |
| postgres | 5432 | PostgreSQL + pgvector (internal) |

## Data Persistence

| Directory | Purpose |
|-----------|---------|
| `./data/` | Uploaded documents, embeddings |
| `./outputs/` | Generated content (infographics, mind maps) |
| `./uploads/` | Temporary upload files |
| `./config/` | Runtime YAML config (`dbnotebook.yaml`, `models.yaml`) |

## Commands

```bash
# Start services
docker compose up -d

# View logs
docker compose logs -f dbnotebook

# Stop services
docker compose down

# Update to latest image
docker compose pull
docker compose up -d

# Reset database (WARNING: deletes all data)
docker compose down -v
docker compose up -d
```

## Troubleshooting

### Cannot pull image
Ensure you're logged into GHCR:
```bash
gh auth token | docker login ghcr.io -u YOUR_USERNAME --password-stdin
```

### Ollama not connecting
- Ensure Ollama is running on host: `ollama serve`
- For Docker, set `OLLAMA_HOST=host.docker.internal` and `OLLAMA_PORT=11434`

### Database connection issues
- For host PostgreSQL, confirm `DATABASE_URL` uses `host.docker.internal`, not `localhost`.
- Confirm the target database exists and `CREATE EXTENSION IF NOT EXISTS vector` succeeds.
- Confirm local PostgreSQL accepts password auth from Docker bridge clients.
- For bundled Docker PostgreSQL, wait for the postgres healthcheck and check `docker compose logs postgres`.

## Features

- **Notebook Management**: Organize documents into notebooks
- **Multi-Provider LLM**: Ollama, OpenAI, Anthropic, Gemini
- **Content Studio**: Generate infographics and mind maps
- **Web Search**: Import content from URLs
- **Vision Processing**: Extract text from images
- **Hybrid Retrieval**: BM25 + vector search with reranking
