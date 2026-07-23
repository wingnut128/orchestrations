# Justfile — task runner for the orchestrations repo.
# Run `just` (or `just --list`) to see all recipes.
#
# `op` wraps targets that need secrets (ANTHROPIC_API_KEY, GITHUB_TOKEN) via
# 1Password's `op run`, reading ./.env as the secret template.
op := "op run --env-file=./.env --"

# Show available recipes (default)
_default:
    @just --list

## Development

# Install dependencies
install:
    bun install

# Start Temporal dev server (UI at http://localhost:8233)
temporal:
    bun run temporal:dev

## Testing

# Run unit tests
test:
    bun test

# Run Biome lint and format check
check:
    bun run check

# Auto-fix Biome lint and format issues
check-fix:
    bun run check:fix

# Run all CI checks (lint + test)
ci: check test

## Workers

# Start greeter worker
worker-greeter:
    bun run worker:greeter

# Start code-review worker (needs op for API key + GitHub token)
worker-review:
    {{op}} bun run worker:review

## Demos

# Run greeter workflow demo
demo-greeter:
    bun run client:greeter

# Run PR code-review demo (needs op for API key + GitHub token)
demo-pr-review:
    {{op}} bun run client:pr-review

## Docker

# Build Docker image
docker-build:
    docker compose build

# Start the full stack in the foreground (all services + workers, rebuilds images)
docker-up:
    docker compose up --build

# Stop all Docker Compose services (tears down the whole project)
docker-down:
    docker compose down

## Local Dev Environment (Forgejo + Temporal + Jaeger)

# Start local dev infra only — Forgejo + Temporal + Jaeger, detached, no workers
dev-up:
    docker compose up -d forgejo temporal temporal-ui jaeger
    @echo ""
    @echo "  Forgejo:      http://localhost:3000"
    @echo "  Temporal UI:  http://localhost:8233"
    @echo "  Jaeger UI:    http://localhost:16686"
    @echo ""
    @echo "  First time? Register at http://localhost:3000/user/sign_up"
    @echo "  (first registered user becomes admin)"

# Stop local dev infra (same as docker-down — tears down the whole project)
alias dev-down := docker-down

# Tail logs for local dev infra
dev-logs:
    docker compose logs -f forgejo temporal temporal-ui
