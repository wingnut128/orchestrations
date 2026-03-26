# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Temporal-based agent orchestration platform. Claude agents subscribe to Temporal workflow events and publish events for other agents to process. Part of the Forge-Decoupled Agentic CI/CD Architecture (Forgejo + Temporal + SPIRE).

## Runtime & Tooling

- **Runtime:** Bun (not Node.js). Use `bun` for all execution, `bun install` for deps, `bun test` for tests.
- **Linter/Formatter:** Biome. Run `bun run check` to lint+format check, `bun run check:fix` to auto-fix. Biome uses tabs and double quotes.
- **Temporal SDK:** `@temporalio/worker`, `@temporalio/client`, `@temporalio/workflow`, `@temporalio/activity`
- **Container images:** Always use Chainguard free-tier base images (`cgr.dev/chainguard/node`, etc.) — never Docker Hub `node:*` defaults.

## Commands

```bash
# Start local Temporal dev server (UI at http://localhost:8233)
bun run temporal:dev

# Run the greeter worker (connects to localhost:7233)
bun run worker:greeter

# Execute the greeter workflow via client
bun run client:greeter

# Lint + format check
bun run check

# Auto-fix lint + format issues
bun run check:fix

# Run tests
bun test
```

## Architecture

```
src/
  activities/   # Temporal activities — the actual work units (API calls, Claude invocations, side effects)
  workflows/    # Temporal workflows — deterministic orchestration logic, no side effects
  workers/      # Worker processes that poll task queues and execute workflows + activities
  clients/      # Scripts that start or signal workflows
```

### Key Temporal Concepts for This Repo

- **Workflows** must be deterministic — no I/O, no randomness, no Date.now(). Use activities for all side effects.
- **Activities** are where Claude agent calls, API requests, and other non-deterministic work happens.
- **Workers** bind workflows + activities to a task queue. Each worker process polls one queue.
- **Signals** allow external events to be sent into running workflows — this is how agents communicate asynchronously.
- **Queries** allow reading workflow state without affecting execution.

### Workflow ↔ Activity Boundary

The Temporal SDK bundles workflows into a V8 isolate with no access to Node/Bun APIs. Import activities via `proxyActivities` only. Never import activity code directly into workflow files.
