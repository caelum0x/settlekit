# SettleKit developer Makefile.
# Run `make help` to list targets.

.DEFAULT_GOAL := help
.PHONY: help install build dev-api dev-worker dev-dashboard db-up db-migrate up down

help: ## List available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

install: ## Install all workspace dependencies
	pnpm install

build: ## Build every package and app
	pnpm -r build

dev-api: ## Run the API in dev mode (port 8787)
	pnpm --filter @settlekit/api dev

dev-worker: ## Run the background worker in dev mode
	pnpm --filter @settlekit/worker dev

dev-dashboard: ## Run the merchant dashboard in dev mode (port 3001)
	pnpm --filter @settlekit/dashboard dev

db-up: ## Start the Postgres service in Docker
	docker compose up -d postgres

db-migrate: ## Apply database migrations
	pnpm --filter @settlekit/database db:migrate

up: ## Build and start the full stack (docker compose up)
	docker compose up --build

down: ## Stop and remove the docker compose stack
	docker compose down
