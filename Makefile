.DEFAULT_GOAL := help

OP_RUN := op run --env-file="./.env" --

## Help
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

## Development
install: ## Install dependencies
	bun install

temporal: ## Start Temporal dev server (UI at http://localhost:8233)
	bun run temporal:dev

## Testing
test: ## Run unit tests
	bun test

check: ## Run Biome lint and format check
	bun run check

check-fix: ## Auto-fix Biome lint and format issues
	bun run check:fix

ci: check test ## Run all CI checks (lint + test)

## Workers
worker-greeter: ## Start greeter worker
	bun run worker:greeter

worker-ci-pipeline: ## Start CI pipeline worker
	bun run worker:ci-pipeline

worker-agent-task: ## Start agent-task worker (needs op for API key)
	$(OP_RUN) bun run worker:agent-task

worker-code-review: ## Start code review worker (needs op for API key)
	$(OP_RUN) bun run worker:code-review

worker-security-scan: ## Start security scan worker
	bun run worker:security-scan

## Webhook
webhook: ## Start webhook receiver (needs op for API key)
	$(OP_RUN) bun run webhook

## Demos
demo-greeter: ## Run greeter workflow demo
	bun run client:greeter

demo-ci-pipeline: ## Run CI pipeline demo (start worker-ci-pipeline first)
	bun run client:ci-pipeline

demo-agent-task: ## Run agent task demo (start worker-agent-task first)
	$(OP_RUN) bun run client:agent-task

demo-code-review: ## Run code review agent demo (starts all workers automatically)
	./scripts/demo-code-review.sh

demo-multi-turn: ## Run multi-turn agent conversation demo (start worker-agent-task first)
	$(OP_RUN) bun run client:multi-turn-demo

demo-fan-out: ## Run fan-out/fan-in agent demo (start worker-ci-pipeline + worker-security-scan first)
	bun run client:fan-out-demo

## Docker
docker-build: ## Build Docker image
	docker compose build

docker-up: ## Start all services with Docker Compose
	docker compose up --build

docker-down: ## Stop all Docker Compose services
	docker compose down

## Local Dev Environment (Forgejo + Temporal + Jaeger)
dev-up: ## Start Forgejo + Temporal + Jaeger (local dev infra)
	docker compose up -d forgejo temporal temporal-ui jaeger
	@echo ""
	@echo "  Forgejo:      http://localhost:3000"
	@echo "  Temporal UI:  http://localhost:8233"
	@echo "  Jaeger UI:    http://localhost:16686"
	@echo ""
	@echo "  First time? Register at http://localhost:3000/user/sign_up"
	@echo "  (first registered user becomes admin)"

dev-down: ## Stop local dev infra
	docker compose down

dev-logs: ## Tail logs for local dev infra
	docker compose logs -f forgejo temporal temporal-ui
