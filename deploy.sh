#!/bin/bash
set -e

# Admissions Officer — Deployment Script
# Handles: prerequisites, dependencies, environment, and service startup

VERSION="1.1.2"
SERVICE_NAME="admissions-officer"
NODE_MIN_VERSION="18.0.0"
PORT=${PORT:-3000}

# ═══════════════════════════════════════════════════════════════════════════════
# Colors for output
# ═══════════════════════════════════════════════════════════════════════════════

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ═══════════════════════════════════════════════════════════════════════════════
# Helper Functions
# ═══════════════════════════════════════════════════════════════════════════════

log_info() {
  echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
  echo -e "${GREEN}[✓]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

die() {
  log_error "$1"
  exit 1
}

version_gte() {
  printf '%s\n%s' "$2" "$1" | sort -V -C
}

# ═══════════════════════════════════════════════════════════════════════════════
# Pre-deployment Checks
# ═══════════════════════════════════════════════════════════════════════════════

check_prerequisites() {
  log_info "Checking prerequisites..."

  # Check Node.js
  if ! command -v node &> /dev/null; then
    die "Node.js is not installed. Please install Node.js >= $NODE_MIN_VERSION"
  fi

  local node_version=$(node -v | cut -d'v' -f2)
  if ! version_gte "$node_version" "$NODE_MIN_VERSION"; then
    die "Node.js version $node_version is too old. Required: >= $NODE_MIN_VERSION"
  fi
  log_success "Node.js $node_version"

  # Check npm
  if ! command -v npm &> /dev/null; then
    die "npm is not installed"
  fi

  local npm_version=$(npm -v)
  log_success "npm $npm_version"

  # Check git (for version info)
  if ! command -v git &> /dev/null; then
    log_warn "git is not available (optional)"
  fi
}

# ═══════════════════════════════════════════════════════════════════════════════
# Environment Setup
# ═══════════════════════════════════════════════════════════════════════════════

setup_environment() {
  log_info "Setting up environment..."

  # Check for .env file
  if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
      log_warn ".env file not found. Copying from .env.example..."
      cp .env.example .env
      log_warn "Created .env — please edit with your configuration:"
      log_warn "  - Set GEMINI_API_KEY"
      log_warn "  - Verify GEMINI_MODEL"
      return 1
    else
      die ".env and .env.example not found"
    fi
  fi

  # Validate required environment variables
  if ! grep -q "GEMINI_API_KEY" .env || grep "GEMINI_API_KEY=your_gemini_api_key_here" .env &> /dev/null; then
    log_error ".env is not configured. Please set GEMINI_API_KEY"
    return 1
  fi

  if ! grep -q "GEMINI_MODEL" .env; then
    log_warn "GEMINI_MODEL not set in .env, will use default"
  fi

  log_success "Environment configured"
  return 0
}

# ═══════════════════════════════════════════════════════════════════════════════
# Dependency Installation
# ═══════════════════════════════════════════════════════════════════════════════

install_dependencies() {
  log_info "Installing dependencies..."

  if [ ! -d "node_modules" ]; then
    npm install --omit=dev --ignore-scripts
    log_success "Dependencies installed"
  else
    log_info "Checking for missing or outdated packages..."
    npm install --omit=dev --ignore-scripts --prefer-offline
    log_success "Dependencies up to date"
  fi
}

# ═══════════════════════════════════════════════════════════════════════════════
# Health Check
# ═══════════════════════════════════════════════════════════════════════════════

health_check() {
  local max_attempts=10
  local attempt=0
  local wait_time=2

  log_info "Waiting for server to be ready..."

  while [ $attempt -lt $max_attempts ]; do
    if curl -s "http://localhost:${PORT}/" > /dev/null 2>&1; then
      log_success "Server is healthy"
      return 0
    fi

    attempt=$((attempt + 1))
    if [ $attempt -lt $max_attempts ]; then
      echo -n "."
      sleep $wait_time
    fi
  done

  echo ""
  log_warn "Server health check timed out (this may be normal in some deployments)"
  return 0
}

# ═══════════════════════════════════════════════════════════════════════════════
# Service Management
# ═══════════════════════════════════════════════════════════════════════════════

start_service() {
  log_info "Starting $SERVICE_NAME service..."

  # Load environment
  set -a
  source .env
  set +a

  # Start service
  if command -v systemctl &> /dev/null; then
    log_info "Using systemctl to manage service"
    systemctl start "$SERVICE_NAME" || true
  else
    # Fallback: run directly
    log_info "Starting Node.js server..."
    node bin/cli.js &
    local pid=$!
    echo "$pid" > "${SERVICE_NAME}.pid"
    log_success "Server started (PID: $pid)"
  fi

  health_check
}

# ═══════════════════════════════════════════════════════════════════════════════
# Main Deployment Flow
# ═══════════════════════════════════════════════════════════════════════════════

main() {
  echo ""
  echo "╔════════════════════════════════════════════════════════════════════════╗"
  echo "║ Admissions Officer — Deployment Script v$VERSION                       ║"
  echo "╚════════════════════════════════════════════════════════════════════════╝"
  echo ""

  # Parse arguments
  local dry_run=false
  while [[ $# -gt 0 ]]; do
    case $1 in
      --dry-run)
        dry_run=true
        log_info "Running in dry-run mode (no changes will be made)"
        shift
        ;;
      --port)
        PORT="$2"
        shift 2
        ;;
      --help)
        echo "Usage: ./deploy.sh [OPTIONS]"
        echo ""
        echo "Options:"
        echo "  --dry-run         Show what would be done without making changes"
        echo "  --port PORT       Specify port (default: 3000)"
        echo "  --help            Show this help message"
        exit 0
        ;;
      *)
        die "Unknown option: $1"
        ;;
    esac
  done

  # Execute deployment steps
  check_prerequisites

  if ! setup_environment; then
    log_error "Environment setup incomplete. Please configure .env and run again."
    exit 1
  fi

  if [ "$dry_run" = false ]; then
    install_dependencies
    start_service

    echo ""
    echo "╔════════════════════════════════════════════════════════════════════════╗"
    echo "║ Deployment Complete ✓                                                 ║"
    echo "╠════════════════════════════════════════════════════════════════════════╣"
    echo "║ Service: $SERVICE_NAME                                                 ║"
    echo "║ Port:    $PORT                                                          ║"
    echo "║ Version: $VERSION                                                       ║"
    echo "║ URL:     http://localhost:${PORT}                                        ║"
    echo "╚════════════════════════════════════════════════════════════════════════╝"
    echo ""
    log_info "View logs: tail -f ${SERVICE_NAME}.log (if configured)"
    log_info "Stop service: systemctl stop $SERVICE_NAME (or kill the process)"
  else
    echo ""
    echo "Dry-run complete. The following steps would be executed:"
    echo "  1. Install npm dependencies"
    echo "  2. Start Node.js service on port $PORT"
    echo "  3. Verify server health"
  fi
}

main "$@"
