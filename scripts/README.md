# Scripts

- `sh/`: Bash scripts for macOS/Linux manual and process-managed runs.
- `ps1/`: PowerShell scripts for Windows automation and NSSM service management.
- `tools/`: helper binaries used by scripts (for example NSSM).

## Manual Run (Foreground)

- macOS/Linux:
  - `bash ./scripts/sh/start.sh`
  - or `bash ./scripts/sh/dev.sh local`
- Windows:
  - `.\venv\Scripts\python.exe -m dbnotebook --host 0.0.0.0 --port 7860`

## Service / Managed Run

- Linux/macOS process manager:
  - `bash ./scripts/sh/prod.sh start`
  - `bash ./scripts/sh/prod.sh status`
  - `bash ./scripts/sh/prod.sh logs`
- Windows service (run in elevated PowerShell):
  - `powershell -ExecutionPolicy Bypass -File .\scripts\ps1\dbnotebook-service.ps1 -Action Install -NodeDir "C:\tools\node-v24.14.0-win-x64" -BootstrapPythonExe "C:\tools\python-3.11.9\python.exe"`
  - `powershell -ExecutionPolicy Bypass -File .\scripts\ps1\dbnotebook-service.ps1 -Action Start`
  - `powershell -ExecutionPolicy Bypass -File .\scripts\ps1\dbnotebook-service.ps1 -Action Status`
  - `powershell -ExecutionPolicy Bypass -File .\scripts\ps1\dbnotebook-service.ps1 -Action Stop`
  - `powershell -ExecutionPolicy Bypass -File .\scripts\ps1\dbnotebook-service.ps1 -Action Uninstall`

## Notes

- Use `bash ./scripts/sh/...` in docs/commands to avoid executable-bit issues on Unix checkouts.
- Startup scripts (`start.sh`, `dev.sh`, `prod.sh`, and Windows service `RunService`) build frontend assets on startup and fail if `frontend/dist/index.html` is missing.
- Windows service registration uses NSSM and auto-downloads `nssm.exe` to `scripts\tools\nssm\nssm.exe` when missing.
- Windows `-Action Start` waits for healthy readiness (`app process + port + /api/health`) before returning; use `-StartTimeoutSec` / `-HealthPollSec` to tune.
- Windows `-Action Status` includes startup phase diagnostics (`StartupPhase`, `FrontendBuildState`, `LastErrorHint`).
- Pass explicit `-NodeDir` and `-BootstrapPythonExe` in most environments.
- If `venv` is missing, the service script creates it, and falls back to `virtualenv.pyz` if `python -m venv` is unavailable.
- Windows bootstrap installs from a filtered requirements file (excluding `uvloop`, OpenTelemetry packages, and `langfuse`) to avoid resolver conflicts.

For full OS deployment flow and reverse-proxy/base-path guidance, see `docs/deployment/CROSS_PLATFORM_DEPLOYMENT.md`.
