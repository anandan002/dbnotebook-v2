# Frontend build stage
FROM node:20-slim AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
ARG VITE_APP_BASE_PATH=/
ENV VITE_APP_BASE_PATH=${VITE_APP_BASE_PATH}
RUN npm run build

# Python build stage
FROM python:3.11-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Create venv and install dependencies
RUN python -m venv /app/venv
ENV PATH="/app/venv/bin:$PATH"

# Install CPU-only PyTorch. Keep this out of requirements-docker.txt so pip
# does not fall back to the default CUDA-enabled PyPI wheel during image builds.
RUN pip install --no-cache-dir torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu

# Install remaining dependencies (without torch)
COPY requirements-docker.txt .
RUN pip install --no-cache-dir -r requirements-docker.txt

# Download HuggingFace reranker models during build (embeddings use OpenAI API)
# Options: large (~3GB, slow), base (~500MB, medium), xsmall (~100MB, fast)
RUN python -c "from sentence_transformers import CrossEncoder; CrossEncoder('mixedbread-ai/mxbai-rerank-base-v1')"

# Pre-download NLTK punkt tokenizer (used by LlamaIndex) to avoid runtime download
RUN python -c "import nltk; nltk.download('punkt_tab', download_dir='/app/venv/lib/python3.11/site-packages/llama_index/core/_static/nltk_cache')"

# Runtime stage
FROM python:3.11-slim

# OCI labels for GitHub Container Registry
LABEL org.opencontainers.image.source="https://github.com/beedev/dbnotebook-v2"
LABEL org.opencontainers.image.description="Multimodal RAG Sales Enablement System"
LABEL org.opencontainers.image.licenses="Apache-2.0"
LABEL org.opencontainers.image.version="1.1.0"

WORKDIR /app

# Set PYTHONPATH for alembic migrations (required for GitHub Actions builds)
ENV PYTHONPATH=/app

RUN apt-get update && apt-get install -y \
    libpq5 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy venv from builder
COPY --from=builder /app/venv /app/venv
ENV PATH="/app/venv/bin:$PATH"

# Copy downloaded HuggingFace models from builder
COPY --from=builder /root/.cache/huggingface /root/.cache/huggingface

# Copy application code
COPY dbnotebook/ dbnotebook/
COPY --from=frontend-builder /app/frontend/dist frontend/dist/
COPY alembic/ alembic/
COPY alembic.ini .
COPY scripts/sh/docker-entrypoint.sh .
RUN chmod +x docker-entrypoint.sh

# Create mount point directories (config files created at runtime)
RUN mkdir -p config data/config outputs/studio uploads

EXPOSE 7860

ENV OLLAMA_HOST=host.docker.internal
ENV OLLAMA_PORT=11434

CMD ["./docker-entrypoint.sh"]
