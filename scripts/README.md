# Scripts

- `sh/`: primary Bash scripts (`start.sh`, `dev.sh`, `prod.sh`, `docker-entrypoint.sh`).
- `ps1/`: PowerShell scripts for Windows automation.

Use Bash scripts directly from repo root, for example `./scripts/sh/dev.sh local`.

For deployment flow by OS, see `docs/deployment/CROSS_PLATFORM_DEPLOYMENT.md`.

Windows service management script:
- `scripts/ps1/dbnotebook-service.ps1`
- Run commands in an elevated (Run as Administrator) PowerShell session.
- Service registration uses NSSM; script auto-downloads `nssm.exe` to `scripts\tools\nssm\nssm.exe` if missing.
- Script defaults currently point to `D:\soft\...`; in most environments pass explicit paths:
  - `-NodeDir "C:\tools\node-v24.14.0-win-x64"`
  - `-BootstrapPythonExe "C:\tools\python-3.11.9\python.exe"`
- If `venv` is missing, the script auto-creates it using `-BootstrapPythonExe` (or global `python` fallback).
- For embeddable Python builds without `venv`, the script falls back to `virtualenv.pyz` (downloaded once to `%TEMP%`).
- On Windows, venv bootstrap installs from a filtered requirements file that skips `uvloop`, OpenTelemetry, and `langfuse` to avoid resolver conflicts.
- Example actions:
  - `powershell -ExecutionPolicy Bypass -File .\scripts\ps1\dbnotebook-service.ps1 -Action Install -NodeDir "C:\tools\node-v24.14.0-win-x64" -BootstrapPythonExe "C:\tools\python-3.11.9\python.exe"`
  - `powershell -ExecutionPolicy Bypass -File .\scripts\ps1\dbnotebook-service.ps1 -Action Start`
  - `powershell -ExecutionPolicy Bypass -File .\scripts\ps1\dbnotebook-service.ps1 -Action Status`
  - `powershell -ExecutionPolicy Bypass -File .\scripts\ps1\dbnotebook-service.ps1 -Action Stop`
  - `powershell -ExecutionPolicy Bypass -File .\scripts\ps1\dbnotebook-service.ps1 -Action Uninstall`
