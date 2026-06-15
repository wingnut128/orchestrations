# Orchestrations

A reference implementation of **deep multi-agent code review on Temporal**. An
orchestrator workflow plans review dimensions for a GitHub pull request, fans out
to worker child workflows (each an Agent SDK tool-loop behind a pluggable runner),
adversarially verifies every finding, and posts a synthesized review back to the PR.

It demonstrates four modern multi-agent patterns together: **Agent SDK tool-loops**
as the worker unit, **orchestrator-worker with typed (Zod) contracts**, **quality
patterns** (parallel fan-out + adversarial verification + an optional completeness
critic), and **Temporal-native durability** (child workflows, retries, heartbeats,
human-in-loop signals).

See the design spec and implementation plan under [`docs/superpowers/`](docs/superpowers/).

## Prerequisites

- [Bun](https://bun.sh) v1.3+
- [Temporal CLI](https://docs.temporal.io/cli) (for the local dev server)
- A GitHub token (`GITHUB_TOKEN`) and an Anthropic API key (`ANTHROPIC_API_KEY`)
- [Docker](https://docs.docker.com/get-docker/) (optional, for containerized deployment)

## Quick Start

```bash
bun install
cp .env.example .env          # set GITHUB_TOKEN and ANTHROPIC_API_KEY

# Terminal 1 — Temporal dev server (UI at http://localhost:8233)
bun run temporal:dev

# Terminal 2 — the review worker
bun run worker:review

# Terminal 3 — review a PR: <owner>/<repo> <pr-number>
bun run client:pr-review wingnut128/orchestrations 49
```

Flags for `client:pr-review`: `--human-gate` (pause for approval before posting),
`--critic` (run the completeness critic), `--min=low|medium|high|critical` (severity
floor for reported findings).

A trivial `greeterWorkflow` (`bun run worker:greeter` / `bun run client:greeter`)
remains as a Temporal + Bun smoke test.

## How a review runs

```
client → reviewOrchestratorWorkflow
  1. fetchPullRequest + checkoutPrToWorkspace   (GitHub API + shallow clone)
  2. planReview            — lead agent picks review dimensions for THIS PR
  3. fan-out               — one reviewWorkerWorkflow (child) per dimension,
                             each an Agent SDK tool-loop (read_file/grep/git_diff)
  4. fan-in                — collect findings; a failed dimension is recorded
                             and skipped (graceful degradation), never fatal
  5. (optional) critic     — completeness critic spawns a bounded extra round
  6. verify                — one verifyFindingWorkflow (child) per finding runs
                             M adversarial verifiers; majority-refute ⇒ dropped
  7. synthesizeReview      — agent writes the human summary; severity-filtered
  8. (optional) human gate — postReviewDecision signal (default off)
  9. postReviewToGitHub    — inline comments + REQUEST_CHANGES / APPROVE
```

### Pluggable agent runner

Each agent runs behind the provider-neutral `AgentRunner` interface
(`src/agents/runner.ts`). `ClaudeAgentRunner` (the Claude Agent SDK) is the only
implementation today; `getRunner(provider)` is a lazy registry, so a `gemini` or
`codex` runner is a new file plus one registry line. Tools are provider-neutral
(`src/agents/tools/`) and sandboxed to the PR checkout, so behavior is identical
across providers.

## Architecture

```
src/
  agents/      runner.ts · claude-runner.ts · fake-runner.ts · tools/
  contracts/   Zod schemas for every workflow/agent boundary
  github/      PR fetch/checkout + review post-back (Octokit)
  activities/  review.ts (plan/run/verify/critic/synthesize) · github.ts
  workflows/   review-orchestrator · review-worker · verify-finding · greeter
  workers/     review.ts (binds the `review` task queue) · greeter.ts
  clients/     run-pr-review.ts · run-greeter.ts
```

### Typed contracts replace a hand-rolled bus

Every workflow boundary and agent output is a [Zod](https://zod.dev) schema — the
single source of truth for the TypeScript type, runtime validation, and the JSON
Schema handed to the LLM for structured output. Fan-in is native Temporal child
workflows (`Promise.all` over child handles), not a custom signal bus.

### Workflow / Activity boundary

The Temporal SDK bundles workflows into a V8 isolate with no access to Node/Bun
APIs. Activities are imported via `proxyActivities` — never import activity code
directly into workflow files. Agent SDK calls, GitHub I/O, and all side effects
live in activities.

## Testing

```bash
bun test          # unit + workflow tests (FakeAgentRunner + @temporalio/testing)
```

Workflow logic is tested deterministically with `@temporalio/testing` and a
`FakeAgentRunner`. A live integration test
(`src/activities/review.integration.test.ts`) runs against a real PR and is
**skipped** unless both `ANTHROPIC_API_KEY` and `GITHUB_TOKEN` are set (override the
target with `IT_OWNER` / `IT_REPO` / `IT_PR`).

## Linting & Formatting

Uses [Biome](https://biomejs.dev/) (tabs, double quotes, import sorting).

```bash
bun run check       # check
bun run check:fix   # auto-fix
```

## Environment

| Variable | Purpose |
|---|---|
| `GITHUB_TOKEN` | GitHub API auth (fetch PR, post review) |
| `GITHUB_API_URL` | GitHub API base (default `https://api.github.com`; set for GHES) |
| `ANTHROPIC_API_KEY` | Claude Agent SDK |
| `TEMPORAL_ADDRESS` | Temporal frontend (default `localhost:7233`) |
| `OTEL_*` | Optional OpenTelemetry tracing |

## CI/CD

- **CodeQL** — static analysis on push, PRs, and weekly
- **Semgrep** — SAST on push, PRs, and weekly
- **Dependabot** — weekly dependency updates for npm and GitHub Actions
