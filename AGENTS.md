# Repository Guidelines

## Project Structure & Module Organization
- `dbnotebook/`: Python backend (Flask API, core RAG pipeline, providers, services, DB layer).
- `dbnotebook/api/routes/`: HTTP endpoints; add new route modules here and register via route setup.
- `dbnotebook/core/`: domain logic (`retrieval`, `sql_chat`, `services`, `observability`, `auth`, etc.).
- `frontend/`: React + TypeScript client (Vite, Tailwind, ESLint).
- `alembic/versions/`: database migrations; every schema change should include a migration.
- `config/` and `.env.example`: runtime model/app configuration.
- `docs/`: architecture, deployment, and API docs.

## Build, Test, and Development Commands
- Backend install: `pip install -e .`
- Run backend directly: `python -m dbnotebook --host localhost --port 7860`
- Full local helper: `./scripts/sh/start.sh` (bootstraps venv/env and starts server)
- Dev orchestrator: `./scripts/sh/dev.sh local` or `./scripts/sh/dev.sh docker`
- Docker stack: `docker compose up --build`
- Frontend setup: `cd frontend && npm install`
- Frontend dev server: `npm run dev`
- Frontend production build: `npm run build`
- Frontend lint: `npm run lint`
- Python tests: `pytest` (current repo includes `test_metadata.py`)

## Coding Style & Naming Conventions
- Python: 4-space indentation, `snake_case` for functions/modules, `PascalCase` for classes, type hints on new public functions.
- Keep API handlers thin; move business logic into `dbnotebook/core/services/` or relevant core modules.
- React/TS: component files in `PascalCase.tsx`, hooks in `useX.ts`, shared types in `frontend/src/types/`.
- Run lint before PRs: `npm run lint` (frontend) and `flake8 .` (backend, consistent with CI intent).

## Testing Guidelines
- Add backend tests under a `tests/` package (prefer `tests/test_<feature>.py`), while keeping root tests runnable.
- Use `pytest` for unit/integration coverage around routes, retrieval, and DB interactions.
- For frontend changes, include at least lint-clean code and manual verification steps in PR notes.

## Commit & Pull Request Guidelines
- Follow existing history style: conventional prefixes like `feat:`, `fix:`, `refactor:`, or scoped forms like `fix(rag): ...`.
- Keep commits focused (one behavior change per commit where possible).
- PRs should include a clear problem/solution summary and linked issue/task.
- PRs should call out migration/config changes (`alembic`, `.env`, `config/*.yaml`).
- PRs should include screenshots or GIFs for UI-impacting changes.
- PRs should list commands run (tests, lint, build) and outcomes.

## Security & Configuration Tips
- Never commit secrets; use `.env` locally and keep `.env.example` updated when adding variables.
- Validate provider keys and DB settings before running `./scripts/sh/dev.sh` or Docker workflows.
