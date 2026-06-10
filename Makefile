MAKEFLAGS += --no-print-directory --output-sync=target

VERBOSE ?= 0

.PHONY: help ensure-node install build lint test format check fix clean

# ─── Setup ────────────────────────────────────────────────────
ensure-node: ## Ensure node and pnpm are available
	@command -v node >/dev/null 2>&1 || { echo "node not found in PATH"; exit 1; }
	@command -v pnpm >/dev/null 2>&1 || { echo "pnpm not found in PATH"; exit 1; }
	@if [ "$(VERBOSE)" = "1" ]; then node -v; pnpm -v; fi

install: ensure-node ## Install all dependencies
	pnpm install

# ─── Commands ──────────────────────────────────────────────────
build: ensure-node ## Build the project
	pnpm build

lint: ensure-node ## Lint JS/TS
	pnpm lint

test: ensure-node ## Run tests
	pnpm test

format: ensure-node ## Apply formatting
	pnpm format

check: ensure-node ## Fast full local checks (lint, build, test)
	pnpm check

fix: ensure-node format ## Auto-fix formatting and linting
	pnpm run lint --fix || true

# ─── Utilities ────────────────────────────────────────────────
clean: ## Remove all node_modules and build artifacts
	find . -name "node_modules" -type d -prune -exec rm -rf {} +
	find . -name "dist" -type d -prune -exec rm -rf {} +
	find . -name "coverage" -type d -prune -exec rm -rf {} +

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-24s\033[0m %s\n", $$1, $$2}'

.DEFAULT_GOAL := help
