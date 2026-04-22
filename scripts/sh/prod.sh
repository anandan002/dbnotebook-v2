#!/bin/bash
# DBNotebook Production Script (Linux)
# Usage: bash ./scripts/sh/prod.sh [start|stop|restart|status|logs]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$SCRIPT_DIR"

# Configuration
APP_NAME="dbnotebook"
APP_PORT="${APP_PORT:-7860}"
PID_FILE="$SCRIPT_DIR/.dbnotebook.pid"
LOG_DIR="$SCRIPT_DIR/logs"
LOG_FILE="$LOG_DIR/app.log"
ERROR_LOG="$LOG_DIR/error.log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_status() { echo -e "${BLUE}▶${NC} $1"; }
print_success() { echo -e "${GREEN}✓${NC} $1"; }
print_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
print_error() { echo -e "${RED}✗${NC} $1"; }

# Ensure log directory exists
mkdir -p "$LOG_DIR"

# Check if PostgreSQL is running
check_postgres() {
    if command -v pg_isready &> /dev/null; then
        if pg_isready -q 2>/dev/null; then
            return 0
        fi
    fi

    # Try connecting directly
    if [ -n "$POSTGRES_HOST" ]; then
        if pg_isready -h "$POSTGRES_HOST" -p "${POSTGRES_PORT:-5432}" -q 2>/dev/null; then
            return 0
        fi
    fi

    # Check if we can connect via DATABASE_URL
    if [ -n "$DATABASE_URL" ]; then
        print_warning "Cannot verify PostgreSQL status, assuming it's running..."
        return 0
    fi

    print_error "PostgreSQL is not running or not reachable"
    echo "  Check your database connection settings in .env"
    return 1
}

# Check if app is running
is_running() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if ps -p "$PID" > /dev/null 2>&1; then
            return 0
        else
            # Stale PID file
            rm -f "$PID_FILE"
        fi
    fi

    # Also check by port
    if lsof -ti:$APP_PORT >/dev/null 2>&1 || ss -tlnp 2>/dev/null | grep -q ":$APP_PORT "; then
        return 0
    fi

    return 1
}

# Get PID
get_pid() {
    if [ -f "$PID_FILE" ]; then
        cat "$PID_FILE"
    else
        lsof -ti:$APP_PORT 2>/dev/null || ss -tlnp 2>/dev/null | grep ":$APP_PORT " | grep -oP 'pid=\K[0-9]+' | head -1
    fi
}

# Load environment
load_env() {
    if [ -f "$SCRIPT_DIR/.env" ]; then
        set -a
        source "$SCRIPT_DIR/.env"
        set +a
        # Ensure localhost for direct deployment
        export DATABASE_URL="${DATABASE_URL//host.docker.internal/localhost}"
        export POSTGRES_HOST="${POSTGRES_HOST//host.docker.internal/localhost}"
    else
        print_error ".env file not found"
        echo "  Copy .env.example to .env and configure it"
        exit 1
    fi
}

# Activate virtual environment and sync dependencies
activate_venv() {
    if [ -d "$SCRIPT_DIR/venv" ]; then
        source "$SCRIPT_DIR/venv/bin/activate"
        print_status "Syncing Python dependencies..."
        python3 -m pip install -q -r "$SCRIPT_DIR/requirements.txt"
    else
        print_error "Virtual environment not found"
        echo "  Run: python3 -m venv venv && pip install -r requirements.txt"
        exit 1
    fi
}

# Build frontend
build_frontend() {
    if [ ! -d "$SCRIPT_DIR/frontend" ]; then
        print_error "Frontend directory not found: $SCRIPT_DIR/frontend"
        exit 1
    fi
    if ! command -v npm >/dev/null 2>&1; then
        print_error "npm is required to build frontend assets but was not found in PATH"
        exit 1
    fi
    print_status "Building frontend..."
    cd "$SCRIPT_DIR/frontend"
    npm install --silent
    npm run build
    cd "$SCRIPT_DIR"
    if [ ! -f "$SCRIPT_DIR/frontend/dist/index.html" ]; then
        print_error "Frontend build output missing (expected frontend/dist/index.html)"
        exit 1
    fi
    print_success "Frontend built"
}

# Run database migrations
run_migrations() {
    print_status "Running database migrations..."
    PYTHONPATH="$SCRIPT_DIR" alembic upgrade head >> "$LOG_FILE" 2>&1
    print_success "Migrations complete"
}

# Start the application
start_app() {
    print_status "Starting $APP_NAME..."

    # Load environment first
    load_env

    # Check if already running
    if is_running; then
        PID=$(get_pid)
        print_warning "$APP_NAME is already running (PID: $PID)"
        echo "  Stop with: bash ./scripts/sh/prod.sh stop"
        return 1
    fi

    # Check PostgreSQL
    check_postgres || exit 1

    # Activate venv and sync dependencies
    activate_venv

    # Build frontend
    build_frontend

    # Run migrations
    run_migrations

    # Start Flask server using the same entry point as dev.sh and Docker
    print_status "Starting Flask server on port $APP_PORT..."

    nohup env PYTHONPATH="$SCRIPT_DIR" \
        python3 -m dbnotebook \
        --host 0.0.0.0 \
        --port "$APP_PORT" \
        >> "$LOG_FILE" 2>> "$ERROR_LOG" &

    PID=$!
    echo $PID > "$PID_FILE"

    # Wait a moment and verify
    sleep 3

    if is_running; then
        print_success "$APP_NAME started successfully"
        echo ""
        echo -e "  ${BLUE}URL:${NC}     http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'localhost'):$APP_PORT"
        echo -e "  ${BLUE}PID:${NC}     $PID"
        echo -e "  ${BLUE}Logs:${NC}    bash ./scripts/sh/prod.sh logs"
        echo -e "  ${BLUE}Status:${NC}  bash ./scripts/sh/prod.sh status"
        echo -e "  ${BLUE}Stop:${NC}    bash ./scripts/sh/prod.sh stop"
        echo ""
    else
        print_error "Failed to start $APP_NAME"
        echo "  Check logs: tail -f $ERROR_LOG"
        rm -f "$PID_FILE"
        exit 1
    fi
}

# Stop the application
stop_app() {
    print_status "Stopping $APP_NAME..."

    if ! is_running; then
        print_warning "$APP_NAME is not running"
        rm -f "$PID_FILE"
        return 0
    fi

    PID=$(get_pid)

    if [ -n "$PID" ]; then
        kill "$PID" 2>/dev/null || true

        # Wait for graceful shutdown
        for i in {1..10}; do
            if ! ps -p "$PID" > /dev/null 2>&1; then
                break
            fi
            sleep 1
        done

        # Force kill if still running
        if ps -p "$PID" > /dev/null 2>&1; then
            print_warning "Graceful shutdown failed, forcing..."
            kill -9 "$PID" 2>/dev/null || true
        fi
    fi

    # Also kill by port if needed
    if lsof -ti:$APP_PORT >/dev/null 2>&1; then
        lsof -ti:$APP_PORT | xargs kill -9 2>/dev/null || true
    fi

    rm -f "$PID_FILE"
    print_success "$APP_NAME stopped"
}

# Restart the application
restart_app() {
    stop_app
    sleep 2
    start_app
}

# Show status
show_status() {
    echo ""
    echo -e "${BLUE}═══ $APP_NAME Status ═══${NC}"
    echo ""

    # Load env for checking
    if [ -f "$SCRIPT_DIR/.env" ]; then
        set -a
        source "$SCRIPT_DIR/.env" 2>/dev/null
        set +a
    fi

    # App status
    if is_running; then
        PID=$(get_pid)
        UPTIME=$(ps -p "$PID" -o etime= 2>/dev/null | tr -d ' ')
        MEM=$(ps -p "$PID" -o rss= 2>/dev/null | awk '{printf "%.1f MB", $1/1024}')
        print_success "Application: Running (PID: $PID, Uptime: $UPTIME, Memory: $MEM)"
        echo -e "    URL: http://localhost:$APP_PORT"
    else
        print_error "Application: Not running"
    fi

    # PostgreSQL status
    if check_postgres 2>/dev/null; then
        print_success "PostgreSQL: Connected"
    else
        print_error "PostgreSQL: Not reachable"
    fi

    # Disk usage
    LOG_SIZE=$(du -sh "$LOG_DIR" 2>/dev/null | cut -f1)
    echo -e "  ${BLUE}○${NC} Log directory: $LOG_DIR ($LOG_SIZE)"

    echo ""
}

# Show logs
show_logs() {
    if [ ! -f "$LOG_FILE" ]; then
        print_warning "No log file found yet"
        return 1
    fi

    echo -e "${BLUE}═══ Application Logs ═══${NC}"
    echo "Log file: $LOG_FILE"
    echo "Error log: $ERROR_LOG"
    echo "Press Ctrl+C to stop"
    echo ""

    tail -f "$LOG_FILE" "$ERROR_LOG" 2>/dev/null
}

# Rotate logs
rotate_logs() {
    print_status "Rotating logs..."

    TIMESTAMP=$(date +%Y%m%d_%H%M%S)

    if [ -f "$LOG_FILE" ]; then
        mv "$LOG_FILE" "$LOG_FILE.$TIMESTAMP"
        gzip "$LOG_FILE.$TIMESTAMP" 2>/dev/null || true
    fi

    if [ -f "$ERROR_LOG" ]; then
        mv "$ERROR_LOG" "$ERROR_LOG.$TIMESTAMP"
        gzip "$ERROR_LOG.$TIMESTAMP" 2>/dev/null || true
    fi

    # Keep only last 7 days of logs
    find "$LOG_DIR" -name "*.gz" -mtime +7 -delete 2>/dev/null || true

    print_success "Logs rotated"

    # Restart to create new log files
    if is_running; then
        print_status "Restarting to apply log rotation..."
        restart_app
    fi
}

# Health check
health_check() {
    if ! is_running; then
        print_error "Application is not running"
        return 1
    fi

    print_status "Running health check..."

    RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$APP_PORT/api/auth/me" --max-time 10 2>/dev/null)

    if [ "$RESPONSE" = "200" ] || [ "$RESPONSE" = "401" ]; then
        print_success "Health check passed (HTTP $RESPONSE)"
        return 0
    else
        print_error "Health check failed (HTTP $RESPONSE)"
        return 1
    fi
}

# Show help
show_help() {
    echo ""
    echo -e "${BLUE}DBNotebook Production Script${NC}"
    echo ""
    echo "Usage: bash ./scripts/sh/prod.sh [command]"
    echo ""
    echo "Commands:"
    echo "  start       Start the application in background"
    echo "  stop        Stop the application"
    echo "  restart     Restart the application"
    echo "  status      Show application status"
    echo "  logs        Follow application logs"
    echo "  health      Run health check"
    echo "  rotate      Rotate log files"
    echo ""
    echo "Environment:"
    echo "  APP_PORT    Override port (default: 7860)"
    echo ""
    echo "Files:"
    echo "  .env        Configuration file"
    echo "  logs/       Log directory"
    echo ""
}

# Main
case "${1:-}" in
    start)
        start_app
        ;;
    stop)
        stop_app
        ;;
    restart)
        restart_app
        ;;
    status|st)
        show_status
        ;;
    logs|log)
        show_logs
        ;;
    health|check)
        health_check
        ;;
    rotate)
        rotate_logs
        ;;
    -h|--help|help)
        show_help
        ;;
    *)
        show_help
        exit 1
        ;;
esac
