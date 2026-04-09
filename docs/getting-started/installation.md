# Installation

This guide covers local setup and production entry points for **Windows, macOS, and Linux**.

See [Cross-Platform Deployment](../deployment/CROSS_PLATFORM_DEPLOYMENT.md) for the full OS matrix.

---

## Prerequisites

### Required

- **Python 3.11+** - backend runtime
- **Node.js 18+** - frontend build
- **PostgreSQL 15+** with **pgvector** extension - vector database

### Optional

- **Docker** - containerized run mode
- **Ollama** - local LLM inference

---

## 1. Clone Repository

```bash
git clone https://github.com/beedev/dbnotebook-v2.git
cd dbnotebook-v2
```

---

## 2. Set Up PostgreSQL + pgvector

=== "macOS (Homebrew)"

    ```bash
    brew install postgresql@17 pgvector
    brew services start postgresql@17

    createdb dbnotebook_dev
    psql -d dbnotebook_dev -c "CREATE USER dbnotebook WITH PASSWORD 'dbnotebook';"
    psql -d dbnotebook_dev -c "GRANT ALL PRIVILEGES ON DATABASE dbnotebook_dev TO dbnotebook;"
    psql -d dbnotebook_dev -c "CREATE EXTENSION IF NOT EXISTS vector;"
    ```

=== "Ubuntu/Debian"

    ```bash
    sudo apt install postgresql postgresql-contrib postgresql-17-pgvector

    sudo -u postgres psql <<EOF
    CREATE USER dbnotebook WITH PASSWORD 'dbnotebook';
    CREATE DATABASE dbnotebook_dev OWNER dbnotebook;
    \c dbnotebook_dev
    CREATE EXTENSION IF NOT EXISTS vector;
    EOF
    ```

=== "Windows"

    Install PostgreSQL 15+ and enable pgvector in `dbnotebook_dev`:

    ```powershell
    psql -d dbnotebook_dev -c "CREATE EXTENSION IF NOT EXISTS vector;"
    ```

---

## 3. Create Virtual Environment and Install Python Dependencies

=== "macOS/Linux"

    ```bash
    python3 -m venv venv
    source venv/bin/activate
    pip install --upgrade pip
    pip install -r requirements.txt
    ```

=== "Windows (PowerShell)"

    ```powershell
    py -3.11 -m venv venv
    .\venv\Scripts\Activate.ps1
    python -m pip install --upgrade pip
    python -m pip install -r requirements.txt
    ```

`openpyxl` (Excel ingestion dependency) is already included in `requirements.txt`.

If dependency resolution fails on Windows (`ResolutionImpossible`), use the service installer path in Step 7. It automatically bootstraps a Windows-filtered requirements set for service mode.

---

## 4. Configure Environment

=== "macOS/Linux"

    ```bash
    cp .env.example .env
    ```

=== "Windows (PowerShell)"

    ```powershell
    Copy-Item .env.example .env
    ```

Set at least:

```bash
LLM_PROVIDER=groq
GROQ_API_KEY=your_key_here
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=your_key_here
DATABASE_URL=postgresql://dbnotebook:dbnotebook@localhost:5432/dbnotebook_dev
```

---

## 5. Build Frontend

=== "macOS/Linux"

    ```bash
    cd frontend
    npm install
    npm run build
    cd ..
    ```

=== "Windows (PowerShell)"

    ```powershell
    Push-Location frontend
    npm install
    npm run build
    Pop-Location
    ```

Expected output: `frontend/dist`

---

## 6. Run Database Migrations

=== "macOS/Linux"

    ```bash
    source venv/bin/activate
    PYTHONPATH=. alembic upgrade head
    ```

=== "Windows (PowerShell)"

    ```powershell
    .\venv\Scripts\alembic.exe upgrade head
    ```

---

## 7. Start Application

=== "macOS/Linux (local dev)"

    ```bash
    ./scripts/sh/dev.sh local
    ```

=== "Windows (foreground process)"

    ```powershell
    .\venv\Scripts\python.exe -m dbnotebook --host 0.0.0.0 --port 7860
    ```

=== "Windows (service mode)"

    Run in elevated PowerShell:

    ```powershell
    powershell -ExecutionPolicy Bypass -File .\scripts\ps1\dbnotebook-service.ps1 `
      -Action Install `
      -NodeDir "C:\tools\node-v24.14.0-win-x64" `
      -BootstrapPythonExe "C:\tools\python-3.11.9\python.exe"

    powershell -ExecutionPolicy Bypass -File .\scripts\ps1\dbnotebook-service.ps1 -Action Start
    powershell -ExecutionPolicy Bypass -File .\scripts\ps1\dbnotebook-service.ps1 -Action Status
    ```

Open http://localhost:7860 and login with `admin` / `admin123`.

---

## Docker Mode

```bash
./scripts/sh/dev.sh docker
# or
docker compose up --build -d
```

Application URL: http://localhost:7007

---

## Production Entry Points

- **macOS/Linux**: `./scripts/sh/prod.sh start`
- **Windows**: `scripts/ps1/dbnotebook-service.ps1` (NSSM-managed service)

For Linux server hardening (`systemd`, Nginx, SSL), see [Server Deployment Guide](../deployment/SERVER_DEPLOYMENT.md).

---

## Verify Installation

1. Health check: `curl http://localhost:7860/api/health`
2. Login UI: http://localhost:7860
3. Create notebook and upload a sample document

---

## Troubleshooting

See [Troubleshooting Guide](../troubleshooting.md) for service failures, resolver issues, and config encoding errors.
