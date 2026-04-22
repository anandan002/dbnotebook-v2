#!/bin/bash
# =============================================================================
# DBNotebook - Sales Enablement System
# Startup Script with Environment Validation
# =============================================================================

set -e  # Exit on error

# Change to repository root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$SCRIPT_DIR"

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default configuration
PORT=${1:-7860}
HOST=${2:-localhost}

# Determine Python command
if command -v python3 &> /dev/null; then
    PYTHON_CMD="python3"
elif command -v python &> /dev/null; then
    PYTHON_CMD="python"
else
    echo -e "${RED}✗ Python is not installed. Please install Python 3.9+ first.${NC}"
    exit 1
fi

# =============================================================================
# Helper Functions
# =============================================================================

print_header() {
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}DBNotebook - Sales Enablement System${NC}"
    echo -e "${BLUE}========================================${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_info() {
    echo -e "${BLUE}→ $1${NC}"
}

# Build frontend assets and assert dist output exists
build_frontend() {
    if [ ! -d "frontend" ]; then
        print_error "Frontend directory not found: $SCRIPT_DIR/frontend"
        exit 1
    fi

    if ! command -v npm >/dev/null 2>&1; then
        print_error "npm is required to build frontend assets but was not found in PATH"
        exit 1
    fi

    print_info "Building frontend assets..."
    pushd frontend >/dev/null
    npm install --silent
    npm run build
    popd >/dev/null

    if [ ! -f "$SCRIPT_DIR/frontend/dist/index.html" ]; then
        print_error "Frontend build completed but dist output is missing (expected frontend/dist/index.html)"
        exit 1
    fi

    print_success "Frontend built (frontend/dist)"
}

# =============================================================================
# Environment Validation
# =============================================================================

validate_environment() {
    print_info "Validating environment..."
    print_success "Python found ($PYTHON_CMD)"

    # Check if venv exists
    if [ ! -d "venv" ]; then
        print_warning "Virtual environment not found"
        print_info "Creating virtual environment..."
        $PYTHON_CMD -m venv venv
        print_success "Virtual environment created"

        print_info "Installing dependencies..."
        source venv/bin/activate
        pip install --upgrade pip
        pip install -e .
        print_success "Dependencies installed"
    else
        print_success "Virtual environment found"
    fi

    # Check if .env file exists
    if [ ! -f ".env" ]; then
        print_warning ".env file not found"
        if [ -f ".env.example" ]; then
            print_info "Copying .env.example to .env"
            cp .env.example .env
            print_success ".env file created"
            print_warning "Please configure .env file with your API keys before running"
        fi
    else
        print_success ".env configuration found"
    fi
}

# =============================================================================
# Process Management
# =============================================================================

cleanup_existing_processes() {
    print_info "Checking for existing processes on port $PORT..."

    # Kill any existing DBNotebook processes
    if pgrep -f "python -m dbnotebook" > /dev/null; then
        print_warning "Stopping existing DBNotebook processes..."
        pkill -f "python -m dbnotebook" 2>/dev/null || true
        sleep 1
    fi

    # Kill any process using the port
    if lsof -ti:$PORT > /dev/null 2>&1; then
        print_warning "Stopping process on port $PORT..."
        lsof -ti:$PORT | xargs kill -9 2>/dev/null || true
        sleep 1
    fi

    print_success "Port $PORT is available"
}

# =============================================================================
# Ollama Management
# =============================================================================

check_ollama() {
    if [ "$HOST" == "localhost" ]; then
        print_info "Checking Ollama server..."

        if ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
            print_warning "Ollama server not responding"

            if command -v ollama &> /dev/null; then
                print_info "Starting Ollama server..."
                ollama serve > /dev/null 2>&1 &
                sleep 2

                if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
                    print_success "Ollama server started"
                else
                    print_warning "Could not start Ollama server automatically"
                    print_info "Please start Ollama manually: 'ollama serve'"
                fi
            else
                print_warning "Ollama not found. For local models, install from: https://ollama.com"
                print_info "Continuing without local model support..."
            fi
        else
            print_success "Ollama server is running"
        fi
    fi
}

# =============================================================================
# Server Startup
# =============================================================================

start_server() {
    print_info "Activating virtual environment..."
    source venv/bin/activate
    print_success "Virtual environment activated"

    echo ""
    print_header
    print_success "Starting DBNotebook Sales Enablement System"
    echo ""
    print_info "Configuration:"
    echo "  • Host: $HOST"
    echo "  • Port: $PORT"
    echo "  • URL:  ${GREEN}http://localhost:$PORT${NC}"
    echo ""
    print_info "Press Ctrl+C to stop the server"
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo ""

    # Start the application (use python from venv)
    python -m dbnotebook --host "$HOST" --port "$PORT"
}

# =============================================================================
# Main Execution
# =============================================================================

main() {
    print_header
    echo ""

    # Validate environment
    validate_environment
    echo ""

    # Cleanup existing processes
    cleanup_existing_processes
    echo ""

    # Check Ollama (if using localhost)
    check_ollama
    echo ""

    # Build frontend assets
    build_frontend
    echo ""

    # Start server
    start_server
}

# Run main function
main
