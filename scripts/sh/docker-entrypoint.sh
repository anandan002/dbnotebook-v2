#!/bin/bash
set -e

echo "Running database migrations..."
alembic upgrade head

echo "Starting DBNotebook..."
exec python -m dbnotebook --host 0.0.0.0 --port 7860
