# Orchestrations

Temporal-based agent orchestration platform. Claude agents subscribe to Temporal workflow events and publish events for other agents to process.

Part of the Forge-Decoupled Agentic CI/CD Architecture — decoupling Git hosting (Forgejo) from workflow orchestration (Temporal) and workload identity (SPIFFE/SPIRE).

## Prerequisites

- [Bun](https://bun.sh) v1.3+
- [Temporal CLI](https://docs.temporal.io/cli) (for local dev server)
- [Docker](https://docs.docker.com/get-docker/) (for containerized deployment)

## Quick Start

```bash
# Install dependencies
bun install

# Start the Temporal dev server (UI at http://localhost:8233)
bun run temporal:dev

# In a second terminal, start a worker
bun run worker:greeter

# In a third terminal, execute a workflow
bun run client:greeter
```

## Available Workflows

| Workflow | Worker | Client | Description |
|---|---|---|---|
| `greeterWorkflow` | `bun run worker:greeter` | `bun run client:greeter` | Basic smoke test — validates Temporal + Bun setup |
| `ciPipelineWorkflow` | `bun run worker:ci-pipeline` | `bun run client:ci-pipeline` | Multi-stage CI pipeline (build, test, review, deploy) with signal-based gates |
| `agentTaskWorkflow` | `bun run worker:agent-task` | `bun run client:agent-task` | Claude-powered agent activity — requires `ANTHROPIC_API_KEY` in `.env` |

## Architecture

```
src/
  activities/   # Work units — API calls, Claude invocations, side effects
  workflows/    # Deterministic orchestration logic — no I/O allowed
  workers/      # Processes that poll Temporal task queues
  clients/      # Scripts that start or signal workflows
```

### Agent-to-Agent Communication

Agents communicate through Temporal **signals** and **queries**:

- **Signals** push events into running workflows (e.g., "code review approved", "deploy approved")
- **Queries** read workflow state without side effects (e.g., "what stage is the pipeline in?")
- **Activities** perform the actual work — including calling Claude via the Anthropic SDK

The CI pipeline workflow demonstrates this pattern: it pauses at the code-review and deploy-approval stages, waiting for external agents to send signals before proceeding.

### Workflow / Activity Boundary

The Temporal SDK bundles workflows into a V8 isolate with no access to Node/Bun APIs. Activities must be imported via `proxyActivities` — never import activity code directly into workflow files.

## Linting & Formatting

Uses [Biome](https://biomejs.dev/) for linting and formatting (tabs, double quotes, import sorting).

```bash
# Check for issues
bun run check

# Auto-fix issues
bun run check:fix
```

## Docker Deployment

All workers share a single Docker image built with [Chainguard](https://www.chainguard.dev/) base images (`cgr.dev/chainguard/node`). The `docker-compose.yml` includes the Temporal server, UI, and all workers.

```bash
# Copy and configure environment
cp .env.example .env
# Edit .env to set ANTHROPIC_API_KEY

# Build and run everything
docker compose up --build
```

Services:

| Service | Port | Description |
|---|---|---|
| `temporal` | 7233 | Temporal gRPC frontend |
| `temporal-ui` | 8233 | Temporal Web UI |
| `worker-greeter` | — | Greeter workflow worker |
| `worker-ci-pipeline` | — | CI pipeline workflow worker |
| `worker-agent-task` | — | Claude agent workflow worker |

## CI/CD

- **CodeQL** — static analysis on push, PRs, and weekly
- **Semgrep** — SAST via Semgrep Cloud on push, PRs, and weekly
- **Dependabot** — weekly dependency updates for npm and GitHub Actions
