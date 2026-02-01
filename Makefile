# Agent HQ Development Makefile
# Usage: make help

.PHONY: help start stop restart \
        start-server stop-server restart-server \
        start-web stop-web restart-web \
        start-daemon stop-daemon restart-daemon build-daemon build-daemon-linux \
        .log-dir logs logs-server logs-web logs-daemon tail-logs \
        status clean clean-logs clean-all

# Default workspace for development
WORKSPACE ?= /tmp/agenthq-test

# Log directory (absolute path)
ROOT_DIR := $(shell pwd)
LOG_DIR := $(ROOT_DIR)/logs

# Colors for output
CYAN := \033[36m
GREEN := \033[32m
YELLOW := \033[33m
RED := \033[31m
RESET := \033[0m

help:
	@echo "$(CYAN)Agent HQ Development Commands$(RESET)"
	@echo ""
	@echo "$(GREEN)All Services:$(RESET)"
	@echo "  make start          - Start all services (server, web, daemon)"
	@echo "  make stop           - Stop all services"
	@echo "  make restart        - Restart all services"
	@echo "  make status         - Show running services"
	@echo ""
	@echo "$(GREEN)Individual Services:$(RESET)"
	@echo "  make start-server   - Start the API server"
	@echo "  make stop-server    - Stop the API server"
	@echo "  make restart-server - Restart the API server"
	@echo ""
	@echo "  make start-web      - Start the web frontend"
	@echo "  make stop-web       - Stop the web frontend"
	@echo "  make restart-web    - Restart the web frontend"
	@echo ""
	@echo "  make start-daemon   - Start the daemon"
	@echo "  make stop-daemon    - Stop the daemon"
	@echo "  make restart-daemon - Restart the daemon (rebuilds first)"
	@echo "  make build-daemon   - Build daemon without starting"
	@echo ""
	@echo "$(GREEN)Logs:$(RESET)"
	@echo "  make logs           - Show log file locations"
	@echo "  make logs-server    - Tail server logs"
	@echo "  make logs-web       - Tail web logs"
	@echo "  make logs-daemon    - Tail daemon logs"
	@echo "  make tail-logs      - Tail all logs simultaneously"
	@echo ""
	@echo "$(GREEN)Configuration:$(RESET)"
	@echo "  WORKSPACE=$(WORKSPACE)"
	@echo "  LOG_DIR=$(LOG_DIR)"
	@echo "  Override with: make start WORKSPACE=/path/to/workspace"

# =============================================================================
# Log directory setup
# =============================================================================

.log-dir:
	@mkdir -p $(LOG_DIR)

# =============================================================================
# Status
# =============================================================================

status:
	@echo "$(CYAN)Service Status:$(RESET)"
	@echo ""
	@echo -n "  Server:  "
	@ss -tlnp 2>/dev/null | grep -q ':3000' && echo "$(GREEN)running$(RESET)" || echo "$(RED)stopped$(RESET)"
	@echo -n "  Web:     "
	@ss -tlnp 2>/dev/null | grep -q ':5173' && echo "$(GREEN)running$(RESET)" || echo "$(RED)stopped$(RESET)"
	@echo -n "  Daemon:  "
	@pgrep -x "agenthq-daemon" > /dev/null && echo "$(GREEN)running$(RESET)" || echo "$(RED)stopped$(RESET)"
	@echo ""
	@echo "$(CYAN)Log Files:$(RESET)"
	@echo "  $(LOG_DIR)/server.log"
	@echo "  $(LOG_DIR)/web.log"
	@echo "  $(LOG_DIR)/daemon.log"
	@echo ""

# =============================================================================
# Logs
# =============================================================================

logs:
	@echo "$(CYAN)Log Files:$(RESET)"
	@echo ""
	@echo "  Server: $(LOG_DIR)/server.log"
	@echo "  Web:    $(LOG_DIR)/web.log"
	@echo "  Daemon: $(LOG_DIR)/daemon.log"
	@echo ""
	@echo "$(CYAN)View logs with:$(RESET)"
	@echo "  make logs-server    # tail server log"
	@echo "  make logs-web       # tail web log"
	@echo "  make logs-daemon    # tail daemon log"
	@echo "  make tail-logs      # tail all logs"
	@echo ""

logs-server:
	@tail -f $(LOG_DIR)/server.log

logs-web:
	@tail -f $(LOG_DIR)/web.log

logs-daemon:
	@tail -f $(LOG_DIR)/daemon.log

tail-logs:
	@tail -f $(LOG_DIR)/server.log $(LOG_DIR)/web.log $(LOG_DIR)/daemon.log

# =============================================================================
# Server (packages/server) - Node.js with tsx watch
# =============================================================================

stop-server:
	@echo "$(YELLOW)Stopping server...$(RESET)"
	@fuser -k 3000/tcp 2>/dev/null || true
	@sleep 1
	@echo "$(GREEN)Server stopped$(RESET)"

start-server: .log-dir
	@echo "$(YELLOW)Starting server...$(RESET)"
	@if ss -tlnp 2>/dev/null | grep -q ':3000'; then \
		echo "$(YELLOW)Server already running$(RESET)"; \
	else \
		echo "=== Server started at $$(date) ===" >> $(LOG_DIR)/server.log; \
		cd packages/server && AGENTHQ_WORKSPACE=$(WORKSPACE) pnpm dev >> $(LOG_DIR)/server.log 2>&1 & \
		sleep 2; \
		echo "$(GREEN)Server started (logs: logs/server.log)$(RESET)"; \
	fi

restart-server: stop-server
	@sleep 1
	@$(MAKE) start-server

# =============================================================================
# Web (packages/web) - Vite dev server
# =============================================================================

stop-web:
	@echo "$(YELLOW)Stopping web...$(RESET)"
	@fuser -k 5173/tcp 2>/dev/null || true
	@sleep 1
	@echo "$(GREEN)Web stopped$(RESET)"

start-web: .log-dir
	@echo "$(YELLOW)Starting web...$(RESET)"
	@if ss -tlnp 2>/dev/null | grep -q ':5173'; then \
		echo "$(YELLOW)Web already running$(RESET)"; \
	else \
		echo "=== Web started at $$(date) ===" >> $(LOG_DIR)/web.log; \
		cd packages/web && pnpm dev >> $(LOG_DIR)/web.log 2>&1 & \
		sleep 2; \
		echo "$(GREEN)Web started (logs: logs/web.log)$(RESET)"; \
	fi

restart-web: stop-web
	@sleep 1
	@$(MAKE) start-web

# =============================================================================
# Daemon (daemon/) - Go binary
# =============================================================================

build-daemon:
	@echo "$(YELLOW)Building daemon...$(RESET)"
	@cd daemon && /usr/local/go/bin/go build -o agenthq-daemon ./cmd/agenthq-daemon
	@echo "$(GREEN)Daemon built$(RESET)"

build-daemon-linux:
	@echo "$(YELLOW)Building daemon for Linux amd64...$(RESET)"
	@cd daemon && GOOS=linux GOARCH=amd64 /usr/local/go/bin/go build -o agenthq-daemon-linux-amd64 ./cmd/agenthq-daemon
	@echo "$(GREEN)Daemon built: daemon/agenthq-daemon-linux-amd64$(RESET)"

stop-daemon:
	@echo "$(YELLOW)Stopping daemon...$(RESET)"
	@pkill -x "agenthq-daemon" 2>/dev/null || true
	@sleep 1
	@echo "$(GREEN)Daemon stopped$(RESET)"

start-daemon: build-daemon .log-dir
	@echo "$(YELLOW)Starting daemon...$(RESET)"
	@if pgrep -x "agenthq-daemon" > /dev/null; then \
		echo "$(YELLOW)Daemon already running$(RESET)"; \
	else \
		echo "=== Daemon started at $$(date) ===" >> $(LOG_DIR)/daemon.log; \
		cd daemon && ./agenthq-daemon >> $(LOG_DIR)/daemon.log 2>&1 & \
		sleep 2; \
		echo "$(GREEN)Daemon started (logs: logs/daemon.log)$(RESET)"; \
	fi

restart-daemon: stop-daemon
	@sleep 1
	@$(MAKE) start-daemon

# =============================================================================
# Combined commands
# =============================================================================

start: start-server start-web start-daemon
	@echo ""
	@echo "$(GREEN)All services started$(RESET)"
	@$(MAKE) status

stop: stop-daemon stop-web stop-server
	@echo ""
	@echo "$(GREEN)All services stopped$(RESET)"

restart: stop
	@sleep 2
	@$(MAKE) start

# =============================================================================
# Cleanup
# =============================================================================

clean:
	@echo "$(YELLOW)Cleaning build artifacts...$(RESET)"
	@rm -f daemon/agenthq-daemon daemon/agenthq-daemon-*
	@echo "$(GREEN)Clean complete$(RESET)"

clean-logs:
	@echo "$(YELLOW)Cleaning logs...$(RESET)"
	@rm -rf $(LOG_DIR)
	@echo "$(GREEN)Logs cleaned$(RESET)"

clean-all: clean clean-logs
