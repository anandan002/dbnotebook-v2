# Cross-Platform Deployment & Configuration

This page is the canonical deployment entry point for **Windows, macOS, and Linux**.

For deep Linux server setup, see [Server Deployment](SERVER_DEPLOYMENT.md).

---

## Deployment Matrix

| Platform | Local Development | Production Process | Service Management | Reverse Proxy |
|----------|-------------------|--------------------|--------------------|---------------|
| macOS / Linux | `./scripts/sh/dev.sh local` | `./scripts/sh/prod.sh start` | `prod.sh` (process manager) | Nginx/Caddy/Apache |
| Windows | `.\venv\Scripts\python.exe -m dbnotebook --host 0.0.0.0 --port 7860` | `scripts/ps1/dbnotebook-service.ps1` | NSSM (via PowerShell script) | IIS/Nginx |

---

## Common Requirements

- Python 3.11+
- Node.js 18+
- PostgreSQL 15+ with pgvector
- `.env` file created from `.env.example`

`openpyxl` is required for Excel ingestion and is included in `requirements.txt`.

---

## macOS / Linux Workflow

```bash
cp .env.example .env
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
./scripts/sh/dev.sh local
```

Production:

```bash
./scripts/sh/prod.sh start
./scripts/sh/prod.sh status
./scripts/sh/prod.sh logs
```

---

## Windows Workflow (PowerShell, elevated for service actions)

```powershell
Copy-Item .env.example .env
py -3.11 -m venv venv
.\venv\Scripts\python.exe -m pip install -r requirements.txt
.\venv\Scripts\alembic.exe upgrade head
```

Install as service:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\ps1\dbnotebook-service.ps1 `
  -Action Install `
  -NodeDir "C:\tools\node-v24.14.0-win-x64" `
  -BootstrapPythonExe "C:\tools\python-3.11.9\python.exe"
```

Then:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\ps1\dbnotebook-service.ps1 -Action Start
powershell -ExecutionPolicy Bypass -File .\scripts\ps1\dbnotebook-service.ps1 -Action Status
```

Notes:

- If `python -m venv` is unavailable (embeddable Python), the script falls back to `virtualenv.pyz`.
- During service bootstrap, Windows uses a filtered requirements install (skips `uvloop`, OpenTelemetry packages, and `langfuse`) to avoid known resolver conflicts.
- Service logs are written to `logs\windows-service.log`.

---

## Base Path and Reverse Proxy

If serving under a subpath (example: `/dbnotebook`):

- Set `DBNOTEBOOK_BASE_PATH=/dbnotebook` in `.env`.
- Windows service users can additionally set `-FrontendBasePath "/dbnotebook"` during install.

Frontend assets are built to `frontend/dist` during startup workflows (`dev.sh`, `prod.sh`, and Windows service `RunService`).

---

## Health and Logs

- Health endpoint: `GET /api/health`
- Linux/macOS logs: `logs/app.log`, `logs/error.log`
- Windows service log: `logs/windows-service.log`

For common failures (dependency resolver, encoding, service state), see [Troubleshooting](../troubleshooting.md).
