# PowerShell Scripts

Repository PowerShell automation scripts (`*.ps1`) for Windows.

## `dbnotebook-service.ps1`

Installs and manages DBNotebook as a Windows service using NSSM.

### Run context

- Use elevated PowerShell (Run as Administrator) for `Install`, `Start`, `Stop`, and `Uninstall`.
- `Status`, `Health`, and `Logs` can be run without elevation.

### Core parameters

- `-Action`: `Install | Start | Stop | Status | Health | Logs | Uninstall`
- `-NodeDir`: required Node runtime directory for frontend build in service mode.
- `-BootstrapPythonExe`: Python path used to create `venv` when missing.
- `-FrontendBasePath`: optional subpath (example `/dbnotebook`).
- `-TailLines`: number of lines shown by `-Action Logs` (default `200`).
- `-StartTimeoutSec`: max wait time for `-Action Start` to reach healthy state (default `900`).
- `-HealthPollSec`: polling interval during `-Action Start` readiness wait (default `5`).
- Service startup validates frontend output (`frontend\dist\index.html`) after build and fails if missing.
- `-Action Start` is blocking: it returns only after app process, port, and `/api/health` are healthy (or timeout).
- Base path precedence in service runtime: explicit `-FrontendBasePath` argument, then `DBNOTEBOOK_BASE_PATH` from service environment, then `/`.

### Typical lifecycle

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\ps1\dbnotebook-service.ps1 -Action Install -NodeDir "D:\soft\node-v24.14.0-win-x64" -BootstrapPythonExe "D:\soft\python-3.11.9-embed-amd64\python.exe"
powershell -ExecutionPolicy Bypass -File .\scripts\ps1\dbnotebook-service.ps1 -Action Start -StartTimeoutSec 1200 -HealthPollSec 5
powershell -ExecutionPolicy Bypass -File .\scripts\ps1\dbnotebook-service.ps1 -Action Status
powershell -ExecutionPolicy Bypass -File .\scripts\ps1\dbnotebook-service.ps1 -Action Health
powershell -ExecutionPolicy Bypass -File .\scripts\ps1\dbnotebook-service.ps1 -Action Logs -TailLines 200
```

Troubleshooting sequence:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\ps1\dbnotebook-service.ps1 -Action Status
powershell -ExecutionPolicy Bypass -File .\scripts\ps1\dbnotebook-service.ps1 -Action Health
powershell -ExecutionPolicy Bypass -File .\scripts\ps1\dbnotebook-service.ps1 -Action Logs -TailLines 200
```

Log files:
- `logs\windows-service.log`: service/bootstrap steps (venv, migrations, npm build, startup markers)
- `logs\windows-app.log`: DBNotebook runtime output

Phase markers in `windows-service.log`:
- `PHASE=VENV`
- `PHASE=MIGRATIONS`
- `PHASE=FRONTEND_NPM_CI`
- `PHASE=FRONTEND_BUILD`
- `PHASE=APP_START`

`-Action Status` includes phase-aware fields:
- `StartupPhase`, `StartupState`, `StartupPhaseMessage`
- `FrontendBuildState`, `LastFrontendBuildTime`
- `LastErrorHint`
- `ConfiguredBasePath`, `ConfiguredBaseSource`, `EffectiveBasePath`, `ServiceArgBasePath`, `EnvBasePath`
