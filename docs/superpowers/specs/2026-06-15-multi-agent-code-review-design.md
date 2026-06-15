# Deep Multi-Agent Code Review — Design Spec

**Date:** 2026-06-15
**Status:** Approved (design) — pending implementation plan
**Supersedes:** the Forgejo-triggered CI-pipeline / signal-bus orchestration pattern

## 1. Purpose & North Star

This repository is a **reference / learning project**: its job is to demonstrate
modern multi-agent workflow patterns *correctly and legibly* on Temporal. A
production CI/CD use case is secondary — getting the pattern right is the point.

Two forces reshape the prior design:

1. **Forgejo is retired.** The Forgejo webhook trigger and diff source are gone;
   GitHub is the sole remote and the new code source.
2. **The multi-agent pattern is modernized.** The prior design hand-rolled
   agent-to-agent communication over Temporal signals/queries, and each "agent"
   was a single plaintext `messages.create` call with no tools. The new design
   demonstrates four patterns together:
   - **Agent SDK tool-loops** as the worker unit (plan → call tools → iterate)
   - **Orchestrator-worker with typed, schema-validated contracts**
   - **Quality patterns** — parallel fan-out, adversarial verification, bounded
     loop-until-dry completeness critic
   - **Temporal-native durability** — child workflows per agent, durable fan-in,
     retries, heartbeats, human-in-loop signals

The flagship scenario that exercises all four is a **deep multi-agent review of a
GitHub pull request**.

## 2. Architecture & Topology

The system is one durable Temporal workflow graph. **Child workflows replace the
hand-rolled signal bus** — fan-in is a native `Promise.all` over child handles.

```
                     run-pr-review.ts (CLI client)
                              │  ReviewRequest {owner, repo, pr}
                              ▼
   ┌─────────────────  reviewOrchestratorWorkflow  ─────────────────┐
   │  1. fetchPullRequest ........... activity (Octokit)             │
   │  2. checkoutPrToWorkspace ...... activity (clone PR → tmp dir)  │
   │  3. planReview ................. activity = LEAD agent (SDK)    │
   │        └─► ReviewPlan { dimensions[], scope + provider each }   │
   │  4. FAN-OUT  ── per dimension ──► reviewWorkerWorkflow (child)  │
   │        │  runAgentReview activity = WORKER agent SDK tool-loop  │
   │        │   (read_file, grep, git_diff, list_files)              │
   │        │   └─► DimensionFindings { findings[] }                 │
   │  5. FAN-IN  ── Promise.all(childHandles) ──► Finding[]          │
   │  6. QUALITY ── per finding ──► verifyFindingWorkflow (child)    │
   │        │  M independent adversarial verifiers (SDK)             │
   │        │  majority-refute ⇒ drop  ⇒ Verdict                     │
   │  6b. (optional) completenessCritic ─► gap? ─► one more round    │
   │  7. synthesizeReview ........... activity (SDK) ─► ReviewReport │
   │  8. (optional) HUMAN GATE ...... signal: postReviewDecision     │
   │  9. postReviewToGitHub ......... activity (Octokit)            │
   └─────────────────────────────────────────────────────────────────┘
```

### Workflow types

| Workflow | Cardinality | Responsibility |
|---|---|---|
| `reviewOrchestratorWorkflow` | 1 per review | Lead: fetch, plan, fan-out, verify, synthesize, post |
| `reviewWorkerWorkflow` | 1 per dimension | Run one dimension's worker agent tool-loop |
| `verifyFindingWorkflow` | 1 per finding | Run M adversarial verifiers, return verdict |

Workers and verifiers are **child workflows, not bare activity calls**, so each is
independently durable, retriable, visible in the Temporal UI, and able to
sub-fan-out later. This is the legible expression of Temporal-native durability.

### Key decisions

- **The lead agent is real** (step 3): an Agent SDK call decides which dimensions
  apply to *this* PR and scopes each to files — no hardcoded dimension list.
- **Fan-out → verify are two distinct Temporal stages** (4–5, then 6) so the
  quality pattern is first-class in event history, not buried inside an agent.
- **Idempotency:** `workflowId = review-{owner}-{repo}-{pr}-{headSha}` — re-runs
  dedupe naturally.
- **Trigger:** CLI client (`bun run client:pr-review owner/repo 49`). A GitHub
  webhook → workflow starter is a documented future extension, not built now.
- **Human gate:** optional, **default OFF**.
- **GitHub post-back** (step 9) is in scope.

## 3. The Pluggable `AgentRunner` Abstraction

The agent SDK is wrapped behind one provider-neutral interface living entirely in
activity-land (never imported into workflows). This enables Claude now,
Gemini/Codex later.

```ts
// src/agents/runner.ts
export interface AgentSession {
  systemPrompt: string;
  task: string;
  tools: ToolSpec[];          // provider-neutral specs
  outputSchema: JSONSchema;   // forces structured output (derived from Zod)
  workingDir: string;         // the PR checkout the agent may read
  maxTurns?: number;
  nativeTools?: boolean;      // opt into SDK-native extra tools
}
export interface AgentOutcome<T = unknown> {
  output: T;                  // validated against outputSchema
  usage: { inputTokens: number; outputTokens: number };
  stopReason: "completed" | "max_turns" | "refused";
}
export interface AgentRunner {
  readonly provider: string;                  // "claude" | "gemini" | "codex"
  run<T>(session: AgentSession): Promise<AgentOutcome<T>>;
}
```

- **`ClaudeAgentRunner`** is the only implementation built now — wraps
  `@anthropic-ai/claude-agent-sdk`, maps `ToolSpec[]` to the SDK's tool format and
  `outputSchema` to its structured-output mechanism, and runs the SDK's own
  plan→tool→iterate loop to completion inside the activity.
- **Factory** `getRunner(provider)` keyed by string; adding a runner later is a new
  file + one registry line. The orchestrator may pick different providers per
  dimension (a `provider` field on each `ReviewDimension`).
- **Tools** (`agents/tools/`) — **neutral core + SDK extras**. A neutral, read-only
  core (`read_file`, `grep`, `list_files`, `git_diff`) scoped to the checkout gives
  apples-to-apples parity across providers; a runner may *additionally* expose
  SDK-native tools when `nativeTools` is set.
- **Liveness:** the wrapping activity heartbeats on each tool-loop turn; a stuck
  agent trips Temporal's heartbeat timeout and retries.

## 4. Typed Contracts & Data Flow

Every workflow boundary and every agent output is a **Zod** schema — the single
source of truth for the TS type, the runtime validator, and the JSON Schema handed
to the LLM, so the three cannot drift.

```ts
// src/contracts/
ReviewRequest     = { owner, repo, pr, providerDefault, humanGate?: bool,
                      minSeverity?: Severity, completenessCritic?: bool }
ReviewPlan        = { dimensions: ReviewDimension[] }
ReviewDimension   = { key, rationale, scopePaths: string[], provider }
Finding           = { id, dimension, file, line?, severity, title, body, suggestedFix? }
DimensionFindings = { dimension, findings: Finding[], coverageNote }
Verdict           = { findingId, real: boolean, confidence, refutation? }
ReviewReport      = { summary, confirmed: Finding[], dropped: Finding[],
                      byDimension, dimensionErrors, usage }
```

`Severity = "low" | "medium" | "high" | "critical"`.
Dimension `key` examples: `correctness`, `security`, `perf`, `tests`, `types`.

### Data flow

1. `ReviewRequest` → `fetchPullRequest` → `PullRequestContext { meta, diff, changedFiles[] }`
2. → lead agent `planReview` → `ReviewPlan` *(Zod-validated; agent retries on invalid output)*
3. each `ReviewDimension` → worker child workflow → `DimensionFindings`
4. `Promise.all` → `Finding[]` (flattened, each tagged with `dimension`)
5. each `Finding` → verify child workflow → M verdicts → majority → kept/dropped
6. *(optional)* completeness critic → gap → one more bounded round (max 2)
7. confirmed `Finding[]`, filtered by `minSeverity` → synthesizer agent → `ReviewReport`
8. `ReviewReport` → `postReviewToGitHub` → PR review with inline comments

### Validation discipline

Validation happens twice — at the **agent output** (runner retries the model on
malformed JSON) and again at the **workflow boundary** (Temporal serializes across
the boundary; a reference project defends at the contract line rather than
trusting). A validation failure surviving agent retries is a **non-retryable**
Temporal failure (re-running a deterministic schema mismatch is pointless).

### Severity gating

`minSeverity` on `ReviewRequest` (default `low` = report all) filters confirmed
findings before synthesis/posting — a tunable gate.

## 5. Quality Layer

- **Adversarial verification** — each finding goes to **M independent verifiers**
  (default 3), each prompted to *refute* it ("default to `real: false` if
  uncertain"). Majority-refute drops the finding. Verifiers may use a different
  provider than the finder for perspective diversity.
- **Completeness critic / bounded loop-until-dry** — **built now, default OFF**
  (`completenessCritic` flag). After synthesis, a critic agent asks "which changed
  file or risk did no dimension cover?"; a gap spawns one more review round, capped
  at **2 rounds total** to guarantee termination.

## 6. Error Handling & Durability

- **Retry policies:** LLM/agent activities retry on transient API errors (cap ~3,
  backoff). Schema-validation failures after agent retries are **non-retryable**.
- **Graceful degradation:** a terminally-failed worker child workflow records a
  `dimensionError` and the orchestrator continues; a partial review still posts
  with failed dimensions flagged. One dimension never sinks the whole review.
- **Heartbeats** on agent activities for stuck-agent detection.
- **Idempotency** via `headSha`-keyed `workflowId`.
- **Human gate** (when enabled): `condition()` on `postReviewDecision` signal with
  a configurable timeout and default action (proceed/abort).

## 7. Testing Strategy

- **Workflow logic** — `@temporalio/testing` + a `FakeAgentRunner` returning canned
  outcomes. Deterministically assert: fan-out count, fan-in, verify-gating (a
  majority-refuted finding is dropped), degradation path, human-gate branches,
  loop-until-dry termination. No API calls.
- **Contract tests** — fixtures validated against Zod schemas.
- **Runner tests** — `ClaudeAgentRunner` against recorded/mocked SDK responses.
- **Live integration test** — gated by `ANTHROPIC_API_KEY` + `GITHUB_TOKEN`, runs
  against one small real PR (mirrors the existing `*.integration.test.ts`
  convention).

## 8. Repo Structure & Migration

```
src/
  agents/      runner.ts · claude-runner.ts · tools/{read_file,grep,git_diff,list_files}.ts
  contracts/   review schemas (zod)
  github/      pr.ts (fetch/checkout) · post-review.ts
  workflows/   review-orchestrator.ts · review-worker.ts · verify-finding.ts · greeter.ts
  activities/  review.ts (plan/run/verify/synthesize/critic) · github.ts · greeter.ts
  workers/     review.ts (binds the review task queue) · greeter.ts
  clients/     run-pr-review.ts · run-greeter.ts
  telemetry/   (kept as-is — tracing already in place)
```

### Retired (old pattern / Forgejo)

- `webhook/`, `verify.ts`, Forgejo bits in `config.ts`
- `signals/agent-protocol.ts` (signal bus → child-workflow fan-in)
- Old-pattern demos: `workflows/{ci-pipeline,agent-task,code-review,security-scan}.ts`
  and `activities/{ci-pipeline,agent-task,code-review,security-scan,claude-agent}.ts`,
  plus their workers/clients
- **Kept:** `greeter` as the trivial smoke test
- Good parts of the old `reviewDiff` / `security-scan` prompts are folded into the
  new dimension agents

### New dependencies

- `@anthropic-ai/claude-agent-sdk` (worker agent unit)
- `zod` (contracts)
- `@octokit/rest` or equivalent (GitHub PR fetch/post)

## 9. Out of Scope (documented extension points)

- GitHub webhook → workflow starter (CLI trigger only for now)
- `GeminiAgentRunner` / `CodexAgentRunner` (interface ready; not implemented)
- SDK-native tool exposure beyond the neutral core (interface ready via
  `nativeTools`)
- Multi-PR / repo-wide audit mode
