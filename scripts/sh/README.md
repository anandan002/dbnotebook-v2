# Shell Scripts (macOS/Linux)

This directory contains Bash entrypoints for manual and managed runs.
All startup flows build frontend assets and fail fast if `frontend/dist/index.html` is missing.

## Scripts

- `start.sh`: foreground startup with environment checks.
- `dev.sh`: local/docker development helper.
- `prod.sh`: background process manager (start/stop/status/logs/health).
- `docker-entrypoint.sh`: container entrypoint (migrations + app start).

## Recommended invocation

Use explicit Bash invocation:

```bash
bash ./scripts/sh/start.sh
bash ./scripts/sh/dev.sh local
bash ./scripts/sh/prod.sh start
```

This avoids permission errors when execute bits are not present on checkout.

## Common commands

```bash
# Dev local
bash ./scripts/sh/dev.sh local

# Dev docker
bash ./scripts/sh/dev.sh docker

# Production-style process management
bash ./scripts/sh/prod.sh start
bash ./scripts/sh/prod.sh status
bash ./scripts/sh/prod.sh logs
bash ./scripts/sh/prod.sh stop
```
