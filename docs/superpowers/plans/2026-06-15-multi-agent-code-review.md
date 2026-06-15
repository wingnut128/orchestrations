# Deep Multi-Agent Code Review — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Temporal-hosted deep multi-agent code reviewer for GitHub PRs: an orchestrator workflow plans review dimensions, fans out to worker child workflows (each an Agent SDK tool-loop behind a pluggable runner), adversarially verifies findings, and posts a synthesized review back to the PR.

**Architecture:** Approach C (hybrid). Temporal child workflows give durable fan-out/fan-in, typed Zod contracts at every boundary, Agent SDK tool-loops inside heartbeating activities, and adversarial verification + optional completeness critic as first-class orchestration stages. See spec: `docs/superpowers/specs/2026-06-15-multi-agent-code-review-design.md`.

**Tech Stack:** Bun, TypeScript, Temporal (`@temporalio/*`), Zod v4 (contracts + JSON Schema), `@anthropic-ai/claude-agent-sdk` (worker agent unit), `@octokit/rest` (GitHub), Biome (tabs, double quotes), `bun:test` + `@temporalio/testing`.

**Conventions to follow (already in this repo):**
- Workflow tests use `TestWorkflowEnvironment.createLocal()` + a `Worker` with `workflowsPath` and mocked `activities` (see `src/workflows/greeter.test.ts`).
- Workers resolve `workflowsPath` with `.ts`/`.js` ext handling and use `createNativeConnection`/`namespace` from `src/temporal-connection.ts` (see `src/workers/greeter.ts`).
- Never import activity code into workflow files; use `proxyActivities`.
- Run lint/format with `bun run check:fix` before each commit; run tests with `bun test`.

---

## File Structure

**Create:**
- `src/contracts/review.ts` — all Zod schemas + inferred types + JSON Schemas
- `src/agents/tools/types.ts` — `ToolSpec`, `ToolContext`
- `src/agents/tools/index.ts` — neutral core tool set (`read_file`, `grep`, `list_files`, `git_diff`)
- `src/agents/runner.ts` — `AgentRunner`, `AgentSession`, `AgentOutcome` interfaces + `getRunner` factory
- `src/agents/fake-runner.ts` — `FakeAgentRunner` for tests
- `src/agents/claude-runner.ts` — `ClaudeAgentRunner` (wraps `@anthropic-ai/claude-agent-sdk`)
- `src/github/types.ts` — `PullRequestContext`
- `src/github/pr.ts` — fetch PR + checkout to workspace (Octokit + git)
- `src/github/post-review.ts` — post a `ReviewReport` as a PR review
- `src/activities/review.ts` — `planReview`, `runAgentReview`, `verifyFinding`, `synthesizeReview`, `completenessCritic`
- `src/activities/github.ts` — `fetchPullRequest`, `checkoutPrToWorkspace`, `postReviewToGitHub`
- `src/workflows/verify-finding.ts` — `verifyFindingWorkflow`
- `src/workflows/review-worker.ts` — `reviewWorkerWorkflow`
- `src/workflows/review-orchestrator.ts` — `reviewOrchestratorWorkflow`
- `src/workers/review.ts` — binds the `review` task queue
- `src/clients/run-pr-review.ts` — CLI trigger
- Test files alongside each (`*.test.ts`) + `src/activities/review.integration.test.ts`

**Modify:**
- `package.json` — deps + scripts
- `src/config.ts` — replace `forgejo`/`webhook` with `github`
- `src/config.test.ts` — drop forgejo/webhook assertions
- `README.md`, `.env.example` — document new flow

**Delete (retire old pattern / Forgejo):**
- `src/webhook/` (server.ts, server.test.ts, verify.ts)
- `src/signals/agent-protocol.ts`
- `src/types/conversation.ts`
- `src/workflows/{ci-pipeline,ci-pipeline.test,agent-task,agent-task.test,code-review,security-scan,security-scan.test}.ts`
- `src/activities/{ci-pipeline,claude-agent,code-review,security-scan,security-scan.test,security-scan.integration.test}.ts`
- `src/workers/{ci-pipeline,code-review,security-scan}.ts`
- `src/clients/{run-ci-pipeline,run-agent-task,run-code-review-demo,run-fan-out-demo,run-multi-turn-demo}.ts`
- `scripts/demo-code-review.sh`

---

## Task 1: Dependencies, config, and retire old pattern

**Files:**
- Modify: `package.json`, `src/config.ts`, `src/config.test.ts`, `.env.example`
- Delete: the files listed under "Delete" above

- [ ] **Step 1: Install new dependencies**

Run:
```bash
bun add zod @anthropic-ai/claude-agent-sdk @octokit/rest
```
Expected: three packages added to `dependencies` in `package.json`.

- [ ] **Step 2: Delete retired files**

Run:
```bash
git rm -r src/webhook \
  src/signals/agent-protocol.ts \
  src/types/conversation.ts \
  src/workflows/ci-pipeline.ts src/workflows/ci-pipeline.test.ts \
  src/workflows/agent-task.ts src/workflows/agent-task.test.ts \
  src/workflows/code-review.ts \
  src/workflows/security-scan.ts src/workflows/security-scan.test.ts \
  src/activities/ci-pipeline.ts src/activities/claude-agent.ts \
  src/activities/code-review.ts \
  src/activities/security-scan.ts src/activities/security-scan.test.ts \
  src/activities/security-scan.integration.test.ts \
  src/workers/ci-pipeline.ts src/workers/code-review.ts src/workers/security-scan.ts \
  src/clients/run-ci-pipeline.ts src/clients/run-agent-task.ts \
  src/clients/run-code-review-demo.ts src/clients/run-fan-out-demo.ts \
  src/clients/run-multi-turn-demo.ts \
  scripts/demo-code-review.sh
```
Expected: files staged for deletion. (`src/signals/` and `src/types/` may now be empty — that's fine; empty dirs aren't tracked.)

- [ ] **Step 3: Replace forgejo/webhook config with github**

In `src/config.ts`, replace the `forgejo` and `webhook` blocks (and their doc comments) with a `github` block. The `parsePort` export stays unused-by-config but keep it (still exported for reuse) OR remove if `bun run check` flags it; prefer keeping it. New block:

```ts
	github: {
		token: process.env.GITHUB_TOKEN ?? "",
		apiUrl: process.env.GITHUB_API_URL ?? "https://api.github.com",
	},
```
Remove the `forgejo:` and `webhook:` keys from the exported `config` object and update the header doc comment to list `GITHUB_TOKEN` / `GITHUB_API_URL` instead of the Forgejo/webhook vars.

- [ ] **Step 4: Update config.test.ts**

Open `src/config.test.ts`. Remove any assertions referencing `config.forgejo` or `config.webhook`. Keep `parsePort` tests. Add one assertion:

```ts
	it("defaults the GitHub API url", () => {
		expect(config.github.apiUrl).toBe("https://api.github.com");
	});
```

- [ ] **Step 5: Update .env.example**

Replace `FORGEJO_*` / `WEBHOOK_*` lines with:
```
# GitHub
GITHUB_TOKEN=
GITHUB_API_URL=https://api.github.com

# Anthropic
ANTHROPIC_API_KEY=
```
Keep the existing `TEMPORAL_*` and `OTEL_*` lines.

- [ ] **Step 6: Verify the slate is clean**

Run:
```bash
bun run check:fix && bun test
```
Expected: Biome passes; the only remaining tests (greeter + config) pass. No references to deleted modules remain (if `bun test` errors on a missing import, grep for the symbol and remove the stray reference).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: retire Forgejo/signal-bus pattern, add review deps + github config"
```

---

## Task 2: Zod contracts

**Files:**
- Create: `src/contracts/review.ts`
- Test: `src/contracts/review.test.ts`

- [ ] **Step 1: Write the failing test**

`src/contracts/review.test.ts`:
```ts
import { describe, expect, it } from "bun:test";
import {
	Finding,
	ReviewPlan,
	ReviewRequest,
	reviewPlanJsonSchema,
} from "./review.ts";

describe("review contracts", () => {
	it("applies ReviewRequest defaults", () => {
		const req = ReviewRequest.parse({ owner: "o", repo: "r", pr: 1 });
		expect(req.providerDefault).toBe("claude");
		expect(req.humanGate).toBe(false);
		expect(req.minSeverity).toBe("low");
		expect(req.completenessCritic).toBe(false);
	});

	it("rejects an invalid severity on a Finding", () => {
		const bad = { id: "f1", dimension: "security", file: "a.ts", severity: "nope", title: "t", body: "b" };
		expect(() => Finding.parse(bad)).toThrow();
	});

	it("derives a JSON schema for the LLM", () => {
		expect(reviewPlanJsonSchema.type).toBe("object");
		expect(JSON.stringify(reviewPlanJsonSchema)).toContain("dimensions");
	});

	it("accepts a full ReviewPlan", () => {
		const plan = ReviewPlan.parse({
			dimensions: [
				{ key: "security", rationale: "auth touched", scopePaths: ["src/auth.ts"], provider: "claude" },
			],
		});
		expect(plan.dimensions).toHaveLength(1);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/contracts/review.test.ts`
Expected: FAIL — `Cannot find module './review.ts'`.

- [ ] **Step 3: Implement the contracts**

`src/contracts/review.ts`:
```ts
import { z } from "zod";

export const Severity = z.enum(["low", "medium", "high", "critical"]);
export type Severity = z.infer<typeof Severity>;

export const SEVERITY_ORDER: Severity[] = ["low", "medium", "high", "critical"];

export const Provider = z.enum(["claude", "gemini", "codex"]);
export type Provider = z.infer<typeof Provider>;

export const ReviewRequest = z.object({
	owner: z.string().min(1),
	repo: z.string().min(1),
	pr: z.number().int().positive(),
	providerDefault: Provider.default("claude"),
	humanGate: z.boolean().default(false),
	minSeverity: Severity.default("low"),
	completenessCritic: z.boolean().default(false),
});
export type ReviewRequest = z.infer<typeof ReviewRequest>;

export const ReviewDimension = z.object({
	key: z.string().min(1),
	rationale: z.string(),
	scopePaths: z.array(z.string()),
	provider: Provider,
});
export type ReviewDimension = z.infer<typeof ReviewDimension>;

export const ReviewPlan = z.object({
	dimensions: z.array(ReviewDimension),
});
export type ReviewPlan = z.infer<typeof ReviewPlan>;

// The lead agent does NOT choose providers — that's an orchestration concern.
// The schema handed to the LLM omits `provider`; planReview fills it afterward.
export const AgentReviewPlan = z.object({
	dimensions: z.array(ReviewDimension.omit({ provider: true })),
});
export type AgentReviewPlan = z.infer<typeof AgentReviewPlan>;

export const Finding = z.object({
	id: z.string().min(1),
	dimension: z.string().min(1),
	file: z.string().min(1),
	line: z.number().int().positive().optional(),
	severity: Severity,
	title: z.string().min(1),
	body: z.string(),
	suggestedFix: z.string().optional(),
});
export type Finding = z.infer<typeof Finding>;

export const DimensionFindings = z.object({
	dimension: z.string().min(1),
	findings: z.array(Finding),
	coverageNote: z.string(),
});
export type DimensionFindings = z.infer<typeof DimensionFindings>;

export const Verdict = z.object({
	findingId: z.string().min(1),
	real: z.boolean(),
	confidence: z.number().min(0).max(1),
	refutation: z.string().optional(),
});
export type Verdict = z.infer<typeof Verdict>;

export const Usage = z.object({
	inputTokens: z.number().int().nonnegative(),
	outputTokens: z.number().int().nonnegative(),
});
export type Usage = z.infer<typeof Usage>;

export const ReviewReport = z.object({
	summary: z.string(),
	confirmed: z.array(Finding),
	dropped: z.array(Finding),
	byDimension: z.record(z.string(), z.number()),
	dimensionErrors: z.record(z.string(), z.string()),
	usage: Usage,
});
export type ReviewReport = z.infer<typeof ReviewReport>;

// JSON Schemas handed to the LLM for structured output.
export const reviewPlanJsonSchema = z.toJSONSchema(AgentReviewPlan);
export const dimensionFindingsJsonSchema = z.toJSONSchema(DimensionFindings);
export const verdictJsonSchema = z.toJSONSchema(Verdict);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/contracts/review.test.ts`
Expected: PASS (4 tests). If `z.toJSONSchema` is missing, ensure zod is v4 (`bun add zod@^4`).

- [ ] **Step 5: Commit**

```bash
bun run check:fix
git add src/contracts/review.ts src/contracts/review.test.ts
git commit -m "feat: add Zod review contracts + LLM JSON schemas"
```

---

## Task 3: Neutral core tools

**Files:**
- Create: `src/agents/tools/types.ts`, `src/agents/tools/index.ts`
- Test: `src/agents/tools/index.test.ts`

- [ ] **Step 1: Define tool types**

`src/agents/tools/types.ts`:
```ts
export interface ToolContext {
	/** Absolute path the tool calls are sandboxed to. */
	workingDir: string;
}

export interface ToolSpec {
	name: string;
	description: string;
	/** JSON Schema (object) describing the tool input. */
	inputSchema: Record<string, unknown>;
	handler: (input: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
}
```

- [ ] **Step 2: Write the failing test**

`src/agents/tools/index.test.ts`:
```ts
import { describe, expect, it } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { coreTools } from "./index.ts";

async function fixture() {
	const dir = await mkdtemp(join(tmpdir(), "tools-"));
	await writeFile(join(dir, "a.ts"), "export const x = 1;\nconst secret = 2;\n");
	return dir;
}
const byName = (n: string) => coreTools.find((t) => t.name === n)!;

describe("core tools", () => {
	it("read_file returns file contents", async () => {
		const dir = await fixture();
		const out = await byName("read_file").handler({ path: "a.ts" }, { workingDir: dir });
		expect(out).toContain("export const x = 1;");
	});

	it("read_file refuses path traversal outside workingDir", async () => {
		const dir = await fixture();
		const out = await byName("read_file").handler({ path: "../../etc/passwd" }, { workingDir: dir });
		expect(out).toMatch(/outside the working directory|not allowed/i);
	});

	it("grep finds matching lines", async () => {
		const dir = await fixture();
		const out = await byName("grep").handler({ pattern: "secret" }, { workingDir: dir });
		expect(out).toContain("a.ts");
		expect(out).toContain("secret");
	});

	it("list_files lists tracked paths", async () => {
		const dir = await fixture();
		const out = await byName("list_files").handler({}, { workingDir: dir });
		expect(out).toContain("a.ts");
	});
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test src/agents/tools/index.test.ts`
Expected: FAIL — `Cannot find module './index.ts'`.

- [ ] **Step 4: Implement the tools**

`src/agents/tools/index.ts`:
```ts
import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { ToolContext, ToolSpec } from "./types.ts";

export type { ToolContext, ToolSpec } from "./types.ts";

/**
 * Resolve a user-supplied path and guarantee it stays inside workingDir.
 * Note: symlinks are not resolved — a symlink inside workingDir that points
 * outside it will not be caught. Acceptable for this reference project (the
 * threat model is a misconfigured workspace, not an adversarial user).
 */
function safeResolve(workingDir: string, p: string): string | null {
	const abs = isAbsolute(p) ? p : resolve(workingDir, p);
	const rel = relative(workingDir, abs);
	if (rel.startsWith("..") || isAbsolute(rel)) return null;
	return abs;
}

async function walk(dir: string, base: string, acc: string[]): Promise<void> {
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		if (entry.name === ".git" || entry.name === "node_modules") continue;
		const full = join(dir, entry.name);
		if (entry.isDirectory()) await walk(full, base, acc);
		else acc.push(relative(base, full));
	}
}

const readFileTool: ToolSpec = {
	name: "read_file",
	description: "Read a UTF-8 text file from the review workspace by relative path.",
	inputSchema: {
		type: "object",
		properties: { path: { type: "string", description: "Path relative to the workspace root." } },
		required: ["path"],
	},
	handler: async (input, ctx) => {
		const abs = safeResolve(ctx.workingDir, String(input.path));
		if (!abs) return `Error: path "${input.path}" is outside the working directory.`;
		try {
			return await readFile(abs, "utf8");
		} catch (err) {
			return `Error reading ${input.path}: ${(err as Error).message}`;
		}
	},
};

const grepTool: ToolSpec = {
	name: "grep",
	description: "Search workspace files for a substring (case-sensitive). Returns matching lines as path:line:text.",
	inputSchema: {
		type: "object",
		properties: { pattern: { type: "string" }, path: { type: "string", description: "Optional subdirectory to limit the search." } },
		required: ["pattern"],
	},
	handler: async (input, ctx) => {
		const root = input.path ? safeResolve(ctx.workingDir, String(input.path)) : ctx.workingDir;
		if (!root) return `Error: path "${input.path}" is outside the working directory.`;
		const pattern = String(input.pattern);
		const files: string[] = [];
		await walk(root, ctx.workingDir, files);
		const lines: string[] = [];
		for (const rel of files) {
			const abs = join(ctx.workingDir, rel);
			try {
				if ((await stat(abs)).size > 1_000_000) continue;
				const text = await readFile(abs, "utf8");
				const fileLines = text.split("\n");
				for (let i = 0; i < fileLines.length; i++) {
					if (fileLines[i].includes(pattern)) {
						lines.push(`${rel}:${i + 1}:${fileLines[i].trim()}`);
						if (lines.length >= 200) break;
					}
				}
			} catch {
				/* skip unreadable/binary files */
			}
			if (lines.length >= 200) break;
		}
		return lines.length ? lines.join("\n") : `No matches for "${pattern}".`;
	},
};

const listFilesTool: ToolSpec = {
	name: "list_files",
	description: "List all files in the workspace (relative paths), excluding .git and node_modules.",
	inputSchema: { type: "object", properties: {} },
	handler: async (_input, ctx) => {
		const acc: string[] = [];
		await walk(ctx.workingDir, ctx.workingDir, acc);
		return acc.length ? acc.sort().join("\n") : "No files found.";
	},
};

const gitDiffTool: ToolSpec = {
	name: "git_diff",
	description: "Show the unified diff of the PR (base vs head) for an optional path.",
	inputSchema: {
		type: "object",
		properties: { path: { type: "string", description: "Optional path to limit the diff." } },
	},
	handler: async (input, ctx) => {
		if (input.path) {
			const guarded = safeResolve(ctx.workingDir, String(input.path));
			if (!guarded) return `Error: path "${input.path}" is outside the working directory.`;
		}
		const args = ["-C", ctx.workingDir, "diff", "--no-color", "refs/pr/base", "refs/pr/head"];
		if (input.path) args.push("--", String(input.path));
		const proc = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "pipe" });
		const [out, err] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		]);
		await proc.exited;
		if (proc.exitCode !== 0) return `Error running git diff: ${err.trim() || "unknown error"}`;
		return out || "No diff.";
	},
};

export const coreTools: ToolSpec[] = [readFileTool, grepTool, listFilesTool, gitDiffTool];
```

> Note on `git_diff`: the checkout activity (Task 6) creates two constant refs — `refs/pr/base` (the PR base SHA) and `refs/pr/head` (the PR head SHA) — so `git diff refs/pr/base refs/pr/head` yields the PR's changes without needing the SHAs threaded into the tool. Two-commit (not three-dot) diff is used so it works with shallow clones (no merge-base needed). stderr is surfaced on non-zero exit so git failures aren't swallowed.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test src/agents/tools/index.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
bun run check:fix
git add src/agents/tools
git commit -m "feat: add provider-neutral read-only agent tools"
```

---

## Task 4: AgentRunner interface + FakeAgentRunner

**Files:**
- Create: `src/agents/runner.ts`, `src/agents/fake-runner.ts`
- Test: `src/agents/fake-runner.test.ts`

- [ ] **Step 1: Define the runner interfaces**

`src/agents/runner.ts`:
```ts
import type { Provider } from "../contracts/review.ts";
import type { ToolSpec } from "./tools/index.ts";

export interface AgentSession {
	systemPrompt: string;
	task: string;
	tools: ToolSpec[];
	/** JSON Schema the final output must satisfy. */
	outputSchema: Record<string, unknown>;
	/** Absolute path the agent's tools are sandboxed to. */
	workingDir: string;
	maxTurns?: number;
	/** Allow the runner to additionally expose SDK-native tools. */
	nativeTools?: boolean;
	/** Invoked on each loop turn so the caller can heartbeat Temporal. */
	onProgress?: (note: string) => void;
}

export interface AgentOutcome<T = unknown> {
	output: T;
	usage: { inputTokens: number; outputTokens: number };
	stopReason: "completed" | "max_turns" | "refused";
}

export interface AgentRunner {
	readonly provider: Provider;
	run<T>(session: AgentSession): Promise<AgentOutcome<T>>;
}

/** Lazily-constructed registry so optional providers don't load until used. */
const registry: Partial<Record<Provider, () => Promise<AgentRunner>>> = {
	claude: async () => new (await import("./claude-runner.ts")).ClaudeAgentRunner(),
};

export async function getRunner(provider: Provider): Promise<AgentRunner> {
	const factory = registry[provider];
	if (!factory) throw new Error(`No AgentRunner registered for provider "${provider}".`);
	return factory();
}
```

- [ ] **Step 2: Write the failing test**

`src/agents/fake-runner.test.ts`:
```ts
import { describe, expect, it } from "bun:test";
import { FakeAgentRunner } from "./fake-runner.ts";

describe("FakeAgentRunner", () => {
	it("returns queued outputs in order and records sessions", async () => {
		const runner = new FakeAgentRunner([{ ok: true }, { ok: false }]);
		const a = await runner.run({ systemPrompt: "s", task: "t1", tools: [], outputSchema: {}, workingDir: "/tmp" });
		const b = await runner.run({ systemPrompt: "s", task: "t2", tools: [], outputSchema: {}, workingDir: "/tmp" });
		expect(a.output).toEqual({ ok: true });
		expect(b.output).toEqual({ ok: false });
		expect(runner.sessions.map((s) => s.task)).toEqual(["t1", "t2"]);
	});

	it("throws when outputs are exhausted", async () => {
		const runner = new FakeAgentRunner([]);
		await expect(
			runner.run({ systemPrompt: "s", task: "t", tools: [], outputSchema: {}, workingDir: "/tmp" }),
		).rejects.toThrow(/exhausted/i);
	});
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test src/agents/fake-runner.test.ts`
Expected: FAIL — `Cannot find module './fake-runner.ts'`.

- [ ] **Step 4: Implement the fake**

`src/agents/fake-runner.ts`:
```ts
import type { Provider } from "../contracts/review.ts";
import type { AgentOutcome, AgentRunner, AgentSession } from "./runner.ts";

/** Deterministic runner for tests — returns queued outputs in order. */
export class FakeAgentRunner implements AgentRunner {
	readonly provider: Provider = "claude";
	readonly sessions: AgentSession[] = [];
	private queue: unknown[];

	constructor(outputs: unknown[]) {
		this.queue = [...outputs];
	}

	async run<T>(session: AgentSession): Promise<AgentOutcome<T>> {
		this.sessions.push(session);
		if (this.queue.length === 0) throw new Error("FakeAgentRunner outputs exhausted");
		session.onProgress?.("fake turn");
		return { output: this.queue.shift() as T, usage: { inputTokens: 10, outputTokens: 20 }, stopReason: "completed" };
	}
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test src/agents/fake-runner.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
bun run check:fix
git add src/agents/runner.ts src/agents/fake-runner.ts src/agents/fake-runner.test.ts
git commit -m "feat: add AgentRunner interface, registry, and FakeAgentRunner"
```

---

## Task 5: ClaudeAgentRunner

**Files:**
- Create: `src/agents/claude-runner.ts`
- Test: `src/agents/claude-runner.test.ts`

- [ ] **Step 1: Confirm the Agent SDK surface**

Use the `claude-code-guide` agent (or read the installed package's type defs under `node_modules/@anthropic-ai/claude-agent-sdk`) to confirm these named exports exist and their shapes: `query`, `tool`, `createSdkMcpServer`, and the message/usage types. The implementation below targets the in-process MCP tool-server pattern (`createSdkMcpServer` + `tool()`), `query({ prompt, options })` returning an async iterable of messages ending in a `result` message carrying final text + `usage`. Adjust names to match the installed version if they differ; keep the runner's behavior identical.

- [ ] **Step 2: Write the failing test (SDK mocked)**

`src/agents/claude-runner.test.ts`:
```ts
import { describe, expect, it, mock } from "bun:test";

// Mock the SDK before importing the runner.
mock.module("@anthropic-ai/claude-agent-sdk", () => ({
	tool: (name: string, _desc: string, _schema: unknown, _fn: unknown) => ({ name }),
	createSdkMcpServer: (cfg: unknown) => ({ cfg }),
	async *query() {
		yield { type: "assistant" };
		yield {
			type: "result",
			subtype: "success",
			result: JSON.stringify({ findingId: "f1", real: false, confidence: 0.9 }),
			usage: { input_tokens: 100, output_tokens: 50 },
		};
	},
}));

const { ClaudeAgentRunner } = await import("./claude-runner.ts");

describe("ClaudeAgentRunner", () => {
	it("parses and validates structured output from the result message", async () => {
		const runner = new ClaudeAgentRunner();
		const outcome = await runner.run({
			systemPrompt: "verify",
			task: "is this real?",
			tools: [],
			outputSchema: { type: "object" },
			workingDir: "/tmp",
		});
		expect(outcome.output).toEqual({ findingId: "f1", real: false, confidence: 0.9 });
		expect(outcome.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
		expect(outcome.stopReason).toBe("completed");
	});
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test src/agents/claude-runner.test.ts`
Expected: FAIL — `Cannot find module './claude-runner.ts'`.

- [ ] **Step 4: Implement the runner**

`src/agents/claude-runner.ts`:
> **Real SDK API (confirmed against `@anthropic-ai/claude-agent-sdk@0.3.177`):** `tool(name, desc, inputSchema, handler)` takes a **Zod raw shape** (`AnyZodRawShape`), NOT a JSON Schema — so convert each ToolSpec's JSON Schema to a Zod raw shape. Tool restriction is done via `options` (verify the exact field — `tools` is the documented restriction lever; `allowedTools` is the auto-approve list). Result message: `{ type: "result", subtype, result: string, usage: { input_tokens, output_tokens } }`.

```ts
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Provider } from "../contracts/review.ts";
import type { AgentOutcome, AgentRunner, AgentSession } from "./runner.ts";

const MODEL = "claude-sonnet-4-6";

/**
 * Convert a ToolSpec's JSON Schema into the Zod raw shape the SDK's tool() wants.
 * Our tools only use object schemas with string properties; required → z.string(),
 * optional → .optional(), and descriptions carry through. This preserves the
 * per-tool typed params (path, pattern, …) the model sees — do NOT collapse to a
 * single opaque `input` field.
 */
function toZodShape(inputSchema: Record<string, unknown>): Record<string, z.ZodTypeAny> {
	const props = (inputSchema.properties ?? {}) as Record<string, { type?: string; description?: string }>;
	const required = new Set((inputSchema.required as string[] | undefined) ?? []);
	const shape: Record<string, z.ZodTypeAny> = {};
	for (const [name, prop] of Object.entries(props)) {
		let field: z.ZodTypeAny = z.string();
		if (prop.description) field = field.describe(prop.description);
		if (!required.has(name)) field = field.optional();
		shape[name] = field;
	}
	return shape;
}

/** Extract the first JSON object from a possibly fenced/prose-wrapped string. */
function extractJson(text: string): unknown {
	const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
	const candidate = fence ? fence[1] : text;
	const start = candidate.indexOf("{");
	const end = candidate.lastIndexOf("}");
	if (start === -1 || end === -1) throw new Error("No JSON object found in agent output");
	return JSON.parse(candidate.slice(start, end + 1));
}

export class ClaudeAgentRunner implements AgentRunner {
	readonly provider: Provider = "claude";

	async run<T>(session: AgentSession): Promise<AgentOutcome<T>> {
		// Wrap our neutral ToolSpecs as an in-process MCP server, preserving typed params.
		const sdkTools = session.tools.map((t) =>
			tool(t.name, t.description, toZodShape(t.inputSchema), async (args: Record<string, unknown>) => {
				session.onProgress?.(`tool:${t.name}`);
				const text = await t.handler(args, { workingDir: session.workingDir });
				return { content: [{ type: "text", text }] };
			}),
		);
		const mcpServer = createSdkMcpServer({ name: "review-tools", tools: sdkTools });

		const system = `${session.systemPrompt}\n\nRespond with ONLY a JSON object matching this schema:\n${JSON.stringify(session.outputSchema)}`;

		let resultText = "";
		let usage = { inputTokens: 0, outputTokens: 0 };
		let stopReason: AgentOutcome["stopReason"] = "completed";

		const mcpToolIds = session.tools.map((t) => `mcp__review-tools__${t.name}`);
		for await (const msg of query({
			prompt: session.task,
			options: {
				model: MODEL,
				systemPrompt: system,
				maxTurns: session.maxTurns ?? 12,
				mcpServers: { "review-tools": mcpServer },
				// Restrict the agent to OUR neutral tools unless nativeTools is opted in.
				// (Use the SDK's documented tool-restriction option — confirm field name in .d.ts.)
				...(session.nativeTools ? {} : { tools: mcpToolIds }),
				cwd: session.workingDir,
			},
		})) {
			session.onProgress?.(`msg:${(msg as { type: string }).type}`);
			const m = msg as { type: string; subtype?: string; result?: string; usage?: { input_tokens: number; output_tokens: number } };
			if (m.type === "result") {
				resultText = m.result ?? "";
				if (m.usage) usage = { inputTokens: m.usage.input_tokens, outputTokens: m.usage.output_tokens };
				if (m.subtype && m.subtype !== "success") stopReason = m.subtype === "error_max_turns" ? "max_turns" : "refused";
			}
		}

		return { output: extractJson(resultText) as T, usage, stopReason };
	}
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test src/agents/claude-runner.test.ts`
Expected: PASS. If the SDK export names differ from Step 1, fix the imports and the result-message field names, then re-run.

- [ ] **Step 6: Commit**

```bash
bun run check:fix
git add src/agents/claude-runner.ts src/agents/claude-runner.test.ts
git commit -m "feat: add ClaudeAgentRunner wrapping the Claude Agent SDK"
```

---

## Task 6: GitHub integration

**Files:**
- Create: `src/github/types.ts`, `src/github/pr.ts`, `src/github/post-review.ts`
- Test: `src/github/pr.test.ts`, `src/github/post-review.test.ts`

- [ ] **Step 1: Define the PR context type**

`src/github/types.ts`:
```ts
export interface ChangedFile {
	path: string;
	status: string;
	additions: number;
	deletions: number;
}

export interface PullRequestContext {
	meta: {
		owner: string;
		repo: string;
		pr: number;
		title: string;
		headSha: string;
		baseSha: string;
		author: string;
	};
	diff: string;
	changedFiles: ChangedFile[];
	/** Absolute path of the checked-out PR head. */
	workingDir: string;
}
```

- [ ] **Step 2: Write the failing test for PR fetch (Octokit mocked)**

`src/github/pr.test.ts`:
```ts
import { describe, expect, it } from "bun:test";
import { buildPrContext } from "./pr.ts";

const fakeOctokit = {
	pulls: {
		get: async () => ({
			data: { title: "Add auth", head: { sha: "headsha" }, base: { sha: "basesha" }, user: { login: "alice" } },
		}),
		listFiles: async () => ({
			data: [{ filename: "src/auth.ts", status: "modified", additions: 10, deletions: 2 }],
		}),
	},
} as unknown as import("@octokit/rest").Octokit;

describe("buildPrContext", () => {
	it("assembles PR metadata and changed files", async () => {
		const ctx = await buildPrContext(fakeOctokit, "o", "r", 7, "/tmp/wd", "raw diff");
		expect(ctx.meta).toEqual({ owner: "o", repo: "r", pr: 7, title: "Add auth", headSha: "headsha", baseSha: "basesha", author: "alice" });
		expect(ctx.changedFiles[0].path).toBe("src/auth.ts");
		expect(ctx.diff).toBe("raw diff");
		expect(ctx.workingDir).toBe("/tmp/wd");
	});
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test src/github/pr.test.ts`
Expected: FAIL — `Cannot find module './pr.ts'`.

- [ ] **Step 4: Implement pr.ts**

`src/github/pr.ts`:
```ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Octokit } from "@octokit/rest";
import { config } from "../config.ts";
import type { PullRequestContext } from "./types.ts";

export function makeOctokit(): Octokit {
	return new Octokit({ auth: config.github.token, baseUrl: config.github.apiUrl });
}

/** Pure assembler — easy to unit test with a fake Octokit. */
export async function buildPrContext(
	octokit: Octokit,
	owner: string,
	repo: string,
	pr: number,
	workingDir: string,
	diff: string,
): Promise<PullRequestContext> {
	const { data: prData } = await octokit.pulls.get({ owner, repo, pull_number: pr });
	const { data: files } = await octokit.pulls.listFiles({ owner, repo, pull_number: pr, per_page: 300 });
	return {
		meta: {
			owner,
			repo,
			pr,
			title: prData.title,
			headSha: prData.head.sha,
			baseSha: prData.base.sha,
			author: prData.user?.login ?? "unknown",
		},
		diff,
		changedFiles: files.map((f) => ({ path: f.filename, status: f.status, additions: f.additions, deletions: f.deletions })),
		workingDir,
	};
}

/** Clone the PR head into a temp dir; leave base reachable as HEAD~1 for git_diff. */
export async function checkoutPr(owner: string, repo: string, pr: number, headSha: string, baseSha: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), `pr-${owner}-${repo}-${pr}-`));
	const cloneUrl = `https://x-access-token:${config.github.token}@github.com/${owner}/${repo}.git`;
	const runGit = async (...args: string[]) => {
		const proc = Bun.spawn(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "pipe" });
		await proc.exited;
		if (proc.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${await new Response(proc.stderr).text()}`);
	};
	await Bun.spawn(["git", "init", dir]).exited;
	await runGit("remote", "add", "origin", cloneUrl);
	await runGit("fetch", "--depth", "1", "origin", baseSha);
	await runGit("fetch", "--depth", "1", "origin", headSha);
	// Constant refs the git_diff tool diffs against (base vs head). The tool
	// runs `git diff refs/pr/base refs/pr/head`, so no SHAs need threading into
	// the agent/tool context.
	await runGit("update-ref", "refs/pr/base", baseSha);
	await runGit("update-ref", "refs/pr/head", headSha);
	// Check out the PR head so read_file/grep see the proposed code.
	await runGit("checkout", headSha);
	return dir;
}

/** Fetch the raw unified diff for a PR via the diff media type. */
export async function fetchPrDiff(octokit: Octokit, owner: string, repo: string, pr: number): Promise<string> {
	const res = await octokit.pulls.get({ owner, repo, pull_number: pr, mediaType: { format: "diff" } });
	return res.data as unknown as string;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test src/github/pr.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing test for post-review**

`src/github/post-review.test.ts`:
```ts
import { describe, expect, it } from "bun:test";
import type { ReviewReport } from "../contracts/review.ts";
import { buildReviewPayload } from "./post-review.ts";

const report: ReviewReport = {
	summary: "2 issues",
	confirmed: [
		{ id: "f1", dimension: "security", file: "src/auth.ts", line: 5, severity: "high", title: "Hardcoded secret", body: "..." },
		{ id: "f2", dimension: "perf", file: "src/x.ts", severity: "low", title: "N+1", body: "..." },
	],
	dropped: [],
	byDimension: { security: 1, perf: 1 },
	dimensionErrors: {},
	usage: { inputTokens: 1, outputTokens: 1 },
};

describe("buildReviewPayload", () => {
	it("maps confirmed findings with a line to inline comments and requests changes", () => {
		const payload = buildReviewPayload(report);
		expect(payload.event).toBe("REQUEST_CHANGES");
		expect(payload.comments).toEqual([{ path: "src/auth.ts", line: 5, body: expect.stringContaining("Hardcoded secret") }]);
		expect(payload.body).toContain("2 issues");
	});

	it("approves when there are no confirmed findings", () => {
		const payload = buildReviewPayload({ ...report, confirmed: [], byDimension: {} });
		expect(payload.event).toBe("APPROVE");
		expect(payload.comments).toEqual([]);
	});
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `bun test src/github/post-review.test.ts`
Expected: FAIL — `Cannot find module './post-review.ts'`.

- [ ] **Step 8: Implement post-review.ts**

`src/github/post-review.ts`:
```ts
import type { Octokit } from "@octokit/rest";
import type { Finding, ReviewReport } from "../contracts/review.ts";

export interface ReviewPayload {
	event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
	body: string;
	comments: { path: string; line: number; body: string }[];
}

function findingComment(f: Finding): string {
	const fix = f.suggestedFix ? `\n\n**Suggested fix:** ${f.suggestedFix}` : "";
	return `**[${f.severity}] ${f.title}** _(${f.dimension})_\n\n${f.body}${fix}`;
}

/** Pure mapping from report → GitHub review payload — unit-testable without the API. */
export function buildReviewPayload(report: ReviewReport): ReviewPayload {
	const comments = report.confirmed
		.filter((f): f is Finding & { line: number } => typeof f.line === "number")
		.map((f) => ({ path: f.file, line: f.line, body: findingComment(f) }));

	const fileless = report.confirmed.filter((f) => typeof f.line !== "number").map(findingComment);
	const body = [`## Multi-agent review`, "", report.summary, ...(fileless.length ? ["", "### Additional findings", ...fileless] : [])].join("\n");

	const event = report.confirmed.length === 0 ? "APPROVE" : "REQUEST_CHANGES";
	return { event, body, comments };
}

export async function postReview(octokit: Octokit, owner: string, repo: string, pr: number, report: ReviewReport): Promise<void> {
	const payload = buildReviewPayload(report);
	await octokit.pulls.createReview({
		owner,
		repo,
		pull_number: pr,
		event: payload.event,
		body: payload.body,
		comments: payload.comments,
	});
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `bun test src/github/post-review.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 10: Commit**

```bash
bun run check:fix
git add src/github
git commit -m "feat: add GitHub PR fetch/checkout and review post-back"
```

---

## Task 7: Review activities

**Files:**
- Create: `src/activities/review.ts`, `src/activities/github.ts`
- Test: `src/activities/review.test.ts`

These activities are the bridge between Temporal and the agents/GitHub. They run in Node/Bun land.

- [ ] **Step 1: Implement the GitHub activities (thin wrappers)**

`src/activities/github.ts`:
```ts
import type { ReviewReport } from "../contracts/review.ts";
import { buildPrContext, checkoutPr, fetchPrDiff, makeOctokit } from "../github/pr.ts";
import { postReview } from "../github/post-review.ts";
import type { PullRequestContext } from "../github/types.ts";

export async function fetchPullRequest(owner: string, repo: string, pr: number): Promise<Omit<PullRequestContext, "workingDir">> {
	const octokit = makeOctokit();
	const diff = await fetchPrDiff(octokit, owner, repo, pr);
	const ctx = await buildPrContext(octokit, owner, repo, pr, "", diff);
	const { workingDir: _omit, ...rest } = ctx;
	return rest;
}

export async function checkoutPrToWorkspace(owner: string, repo: string, pr: number, headSha: string, baseSha: string): Promise<string> {
	return checkoutPr(owner, repo, pr, headSha, baseSha);
}

export async function postReviewToGitHub(owner: string, repo: string, pr: number, report: ReviewReport): Promise<void> {
	await postReview(makeOctokit(), owner, repo, pr, report);
}
```

- [ ] **Step 2: Write the failing test for review activities**

`src/activities/review.test.ts`:
```ts
import { describe, expect, it } from "bun:test";
import { FakeAgentRunner } from "../agents/fake-runner.ts";
import type { DimensionFindings, Finding } from "../contracts/review.ts";
import { runAgentReviewWith, synthesizeReviewWith, verifyFindingWith } from "./review.ts";

const ctx = { owner: "o", repo: "r", pr: 1, headSha: "h", baseSha: "b" };
const finding: Finding = { id: "f1", dimension: "security", file: "a.ts", line: 3, severity: "high", title: "t", body: "b" };

describe("review activities (runner-injected)", () => {
	it("runAgentReview validates worker output against DimensionFindings", async () => {
		const out: DimensionFindings = { dimension: "security", findings: [finding], coverageNote: "ok" };
		const runner = new FakeAgentRunner([out]);
		const result = await runAgentReviewWith(runner, { key: "security", rationale: "r", scopePaths: ["a.ts"], provider: "claude" }, "/tmp", ctx, () => {});
		expect(result.findings[0].id).toBe("f1");
	});

	it("runAgentReview throws (non-retryable) on malformed output", async () => {
		const runner = new FakeAgentRunner([{ nope: true }]);
		await expect(
			runAgentReviewWith(runner, { key: "security", rationale: "r", scopePaths: [], provider: "claude" }, "/tmp", ctx, () => {}),
		).rejects.toThrow();
	});

	it("verifyFinding returns majority verdict from M verifiers", async () => {
		// two refute, one supports → real=false
		const runner = new FakeAgentRunner([
			{ findingId: "f1", real: false, confidence: 0.8 },
			{ findingId: "f1", real: false, confidence: 0.7 },
			{ findingId: "f1", real: true, confidence: 0.6 },
		]);
		const verdict = await verifyFindingWith(runner, finding, "/tmp", 3, () => {});
		expect(verdict.real).toBe(false);
	});

	it("synthesizeReview assembles a report and counts by dimension", async () => {
		const runner = new FakeAgentRunner([{ summary: "1 issue" }]);
		const report = await synthesizeReviewWith(runner, [finding], [], {}, { inputTokens: 5, outputTokens: 6 }, "low", () => {});
		expect(report.summary).toBe("1 issue");
		expect(report.confirmed).toHaveLength(1);
		expect(report.byDimension.security).toBe(1);
	});
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test src/activities/review.test.ts`
Expected: FAIL — `Cannot find module './review.ts'`.

- [ ] **Step 4: Implement review.ts**

`src/activities/review.ts`:
```ts
import { Context } from "@temporalio/activity";
import { getRunner } from "../agents/runner.ts";
import type { AgentRunner } from "../agents/runner.ts";
import { coreTools } from "../agents/tools/index.ts";
import {
	AgentReviewPlan,
	DimensionFindings,
	Finding,
	type Provider,
	type ReviewPlan,
	type ReviewReport,
	type Severity,
	SEVERITY_ORDER,
	Verdict,
	dimensionFindingsJsonSchema,
	reviewPlanJsonSchema,
	verdictJsonSchema,
} from "../contracts/review.ts";
import type { PullRequestContext } from "../github/types.ts";

interface PrRef {
	owner: string;
	repo: string;
	pr: number;
	headSha: string;
	baseSha: string;
}

/** Heartbeat helper that tolerates being called outside an activity (tests). */
function heartbeat(note: string): void {
	try {
		Context.current().heartbeat(note);
	} catch {
		/* not in an activity context */
	}
}

// ---- planReview (lead agent) ----

export async function planReview(pr: PullRequestContext, providerDefault: Provider): Promise<ReviewPlan> {
	const runner = await getRunner(providerDefault);
	const filesList = pr.changedFiles.map((f) => `${f.path} (+${f.additions}/-${f.deletions})`).join("\n");
	const out = await runner.run({
		systemPrompt:
			"You are the lead reviewer. Decide which review dimensions (correctness, security, perf, tests, types, etc.) genuinely apply to THIS PR and scope each to the relevant files. Skip dimensions that don't apply.",
		task: `PR: ${pr.meta.title}\n\nChanged files:\n${filesList}\n\nDiff:\n${pr.diff.slice(0, 50_000)}`,
		tools: coreTools,
		outputSchema: reviewPlanJsonSchema,
		workingDir: pr.workingDir,
		onProgress: heartbeat,
	});
	const plan = AgentReviewPlan.parse(out.output);
	// the lead agent omits provider; assign the request default to each dimension
	return { dimensions: plan.dimensions.map((d) => ({ ...d, provider: providerDefault })) };
}

// ---- runAgentReview (worker agent) ----

export async function runAgentReviewWith(
	runner: AgentRunner,
	dimension: ReviewPlan["dimensions"][number],
	workingDir: string,
	_pr: PrRef,
	onProgress: (n: string) => void,
): Promise<DimensionFindings> {
	const out = await runner.run({
		systemPrompt: `You are a ${dimension.key} reviewer. Investigate the PR using the tools. Report concrete, evidence-backed findings only — no speculation. ${dimension.rationale}`,
		task: `Review these paths for ${dimension.key} issues: ${dimension.scopePaths.join(", ") || "(whole diff)"}. Use git_diff and read_file to gather evidence.`,
		tools: coreTools,
		outputSchema: dimensionFindingsJsonSchema,
		workingDir,
		onProgress,
	});
	return DimensionFindings.parse(out.output);
}

export async function runAgentReview(dimension: ReviewPlan["dimensions"][number], workingDir: string, pr: PrRef): Promise<DimensionFindings> {
	const runner = await getRunner(dimension.provider);
	return runAgentReviewWith(runner, dimension, workingDir, pr, heartbeat);
}

// ---- verifyFinding (adversarial verifiers) ----

export async function verifyFindingWith(
	runner: AgentRunner,
	finding: Finding,
	workingDir: string,
	verifierCount: number,
	onProgress: (n: string) => void,
): Promise<Verdict> {
	const verdicts: Verdict[] = [];
	for (let i = 0; i < verifierCount; i++) {
		const out = await runner.run({
			systemPrompt:
				"You are an adversarial verifier. Try to REFUTE the claimed finding by inspecting the code. Default to real=false if you cannot confirm it with evidence.",
			task: `Finding to refute:\n${JSON.stringify(finding)}\n\nInspect ${finding.file} and decide if it is real.`,
			tools: coreTools,
			outputSchema: verdictJsonSchema,
			workingDir,
			onProgress,
		});
		verdicts.push(Verdict.parse(out.output));
	}
	const realVotes = verdicts.filter((v) => v.real).length;
	const real = realVotes > verifierCount / 2;
	const avg = verdicts.reduce((s, v) => s + v.confidence, 0) / verdicts.length;
	return { findingId: finding.id, real, confidence: avg, refutation: real ? undefined : verdicts.find((v) => !v.real)?.refutation };
}

export async function verifyFinding(finding: Finding, workingDir: string, provider: Provider, verifierCount: number): Promise<Verdict> {
	const runner = await getRunner(provider);
	return verifyFindingWith(runner, finding, workingDir, verifierCount, heartbeat);
}

// ---- completenessCritic ----

export async function completenessCritic(pr: PullRequestContext, covered: string[], provider: Provider): Promise<ReviewPlan> {
	const runner = await getRunner(provider);
	const out = await runner.run({
		systemPrompt: "You are a completeness critic. Identify changed files or risks that the already-covered dimensions missed. Return ONLY new dimensions worth running; return an empty list if coverage is complete.",
		task: `Covered dimensions: ${covered.join(", ")}\nChanged files:\n${pr.changedFiles.map((f) => f.path).join("\n")}`,
		tools: coreTools,
		outputSchema: reviewPlanJsonSchema,
		workingDir: pr.workingDir,
		onProgress: heartbeat,
	});
	const plan = AgentReviewPlan.parse(out.output);
	return { dimensions: plan.dimensions.map((d) => ({ ...d, provider })) };
}

// ---- synthesizeReview ----

function meetsSeverity(s: Severity, min: Severity): boolean {
	return SEVERITY_ORDER.indexOf(s) >= SEVERITY_ORDER.indexOf(min);
}

export async function synthesizeReviewWith(
	runner: AgentRunner,
	confirmed: Finding[],
	dropped: Finding[],
	dimensionErrors: Record<string, string>,
	usage: { inputTokens: number; outputTokens: number },
	minSeverity: Severity,
	onProgress: (n: string) => void,
): Promise<ReviewReport> {
	const filtered = confirmed.filter((f) => meetsSeverity(f.severity, minSeverity));
	const out = await runner.run({
		systemPrompt: "You are the review synthesizer. Write a concise human-readable summary of the confirmed findings for a PR author.",
		task: `Confirmed findings:\n${JSON.stringify(filtered)}`,
		tools: [],
		outputSchema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] },
		workingDir: "/tmp",
		onProgress,
	});
	const summary = (out.output as { summary: string }).summary;
	const byDimension: Record<string, number> = {};
	for (const f of filtered) byDimension[f.dimension] = (byDimension[f.dimension] ?? 0) + 1;
	return { summary, confirmed: filtered, dropped, byDimension, dimensionErrors, usage };
}

export async function synthesizeReview(
	confirmed: Finding[],
	dropped: Finding[],
	dimensionErrors: Record<string, string>,
	usage: { inputTokens: number; outputTokens: number },
	minSeverity: Severity,
	provider: Provider,
): Promise<ReviewReport> {
	const runner = await getRunner(provider);
	return synthesizeReviewWith(runner, confirmed, dropped, dimensionErrors, usage, minSeverity, heartbeat);
}
```

> The `*With` variants take an injected `AgentRunner` so tests use `FakeAgentRunner`; the plain exports resolve the real runner via `getRunner` and are what the worker registers. Signature of `synthesizeReviewWith`: `(runner, confirmed, dropped, dimensionErrors, usage, minSeverity, onProgress)`.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test src/activities/review.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
bun run check:fix
git add src/activities/review.ts src/activities/github.ts src/activities/review.test.ts
git commit -m "feat: add review + github activities with injectable runner"
```

---

## Task 8: verifyFindingWorkflow

**Files:**
- Create: `src/workflows/verify-finding.ts`
- Test: `src/workflows/verify-finding.test.ts`

- [ ] **Step 1: Implement the workflow**

`src/workflows/verify-finding.ts`:
```ts
import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "../activities/review.ts";
import type { Finding, Provider, Verdict } from "../contracts/review.ts";

const { verifyFinding } = proxyActivities<typeof activities>({
	startToCloseTimeout: "180s",
	heartbeatTimeout: "30s",
	retry: { maximumAttempts: 3 },
});

export interface VerifyFindingInput {
	finding: Finding;
	workingDir: string;
	provider: Provider;
	verifierCount: number;
}

export async function verifyFindingWorkflow(input: VerifyFindingInput): Promise<Verdict> {
	return verifyFinding(input.finding, input.workingDir, input.provider, input.verifierCount);
}
```

- [ ] **Step 2: Write the test**

`src/workflows/verify-finding.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import type { Finding } from "../contracts/review.ts";

let testEnv: TestWorkflowEnvironment;
beforeAll(async () => { testEnv = await TestWorkflowEnvironment.createLocal(); }, 30_000);
afterAll(async () => { await testEnv?.teardown(); });

const finding: Finding = { id: "f1", dimension: "security", file: "a.ts", severity: "high", title: "t", body: "b" };

describe("verifyFindingWorkflow", () => {
	it("returns the verdict from the activity", async () => {
		const { client, nativeConnection } = testEnv;
		const taskQueue = "test-verify";
		const worker = await Worker.create({
			connection: nativeConnection,
			taskQueue,
			workflowsPath: new URL("./verify-finding.ts", import.meta.url).pathname,
			activities: { verifyFinding: async () => ({ findingId: "f1", real: true, confidence: 0.9 }) },
		});
		const result = await worker.runUntil(
			client.workflow.execute("verifyFindingWorkflow", {
				args: [{ finding, workingDir: "/tmp", provider: "claude", verifierCount: 3 }],
				workflowId: "test-verify-1",
				taskQueue,
			}),
		);
		expect(result).toEqual({ findingId: "f1", real: true, confidence: 0.9 });
	});
});
```

- [ ] **Step 3: Run test**

Run: `bun test src/workflows/verify-finding.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
bun run check:fix
git add src/workflows/verify-finding.ts src/workflows/verify-finding.test.ts
git commit -m "feat: add verifyFindingWorkflow"
```

---

## Task 9: reviewWorkerWorkflow

**Files:**
- Create: `src/workflows/review-worker.ts`
- Test: `src/workflows/review-worker.test.ts`

- [ ] **Step 1: Implement the workflow**

`src/workflows/review-worker.ts`:
```ts
import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "../activities/review.ts";
import type { DimensionFindings, ReviewDimension } from "../contracts/review.ts";

const { runAgentReview } = proxyActivities<typeof activities>({
	startToCloseTimeout: "300s",
	heartbeatTimeout: "30s",
	retry: { maximumAttempts: 3 },
});

export interface ReviewWorkerInput {
	dimension: ReviewDimension;
	workingDir: string;
	pr: { owner: string; repo: string; pr: number; headSha: string; baseSha: string };
}

export async function reviewWorkerWorkflow(input: ReviewWorkerInput): Promise<DimensionFindings> {
	return runAgentReview(input.dimension, input.workingDir, input.pr);
}
```

- [ ] **Step 2: Write the test**

`src/workflows/review-worker.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import type { ReviewDimension } from "../contracts/review.ts";

let testEnv: TestWorkflowEnvironment;
beforeAll(async () => { testEnv = await TestWorkflowEnvironment.createLocal(); }, 30_000);
afterAll(async () => { await testEnv?.teardown(); });

const dimension: ReviewDimension = { key: "security", rationale: "r", scopePaths: ["a.ts"], provider: "claude" };

describe("reviewWorkerWorkflow", () => {
	it("returns the dimension findings from the activity", async () => {
		const { client, nativeConnection } = testEnv;
		const taskQueue = "test-worker";
		const findings = { dimension: "security", findings: [], coverageNote: "ok" };
		const worker = await Worker.create({
			connection: nativeConnection,
			taskQueue,
			workflowsPath: new URL("./review-worker.ts", import.meta.url).pathname,
			activities: { runAgentReview: async () => findings },
		});
		const result = await worker.runUntil(
			client.workflow.execute("reviewWorkerWorkflow", {
				args: [{ dimension, workingDir: "/tmp", pr: { owner: "o", repo: "r", pr: 1, headSha: "h", baseSha: "b" } }],
				workflowId: "test-worker-1",
				taskQueue,
			}),
		);
		expect(result).toEqual(findings);
	});
});
```

- [ ] **Step 3: Run test**

Run: `bun test src/workflows/review-worker.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
bun run check:fix
git add src/workflows/review-worker.ts src/workflows/review-worker.test.ts
git commit -m "feat: add reviewWorkerWorkflow"
```

---

## Task 10: reviewOrchestratorWorkflow

**Files:**
- Create: `src/workflows/review-orchestrator.ts`
- Test: `src/workflows/review-orchestrator.test.ts`

- [ ] **Step 1: Implement the orchestrator**

`src/workflows/review-orchestrator.ts`:
```ts
import {
	type ChildWorkflowHandle,
	condition,
	defineSignal,
	proxyActivities,
	setHandler,
	startChild,
	uuid4,
	workflowInfo,
} from "@temporalio/workflow";
import type * as ghActivities from "../activities/github.ts";
import type * as reviewActivities from "../activities/review.ts";
import type { DimensionFindings, Finding, ReviewReport, ReviewRequest } from "../contracts/review.ts";
import type { PullRequestContext } from "../github/types.ts";
import { reviewWorkerWorkflow } from "./review-worker.ts";
import { verifyFindingWorkflow } from "./verify-finding.ts";

const VERIFIER_COUNT = 3;

const { fetchPullRequest, checkoutPrToWorkspace, postReviewToGitHub } = proxyActivities<typeof ghActivities>({
	startToCloseTimeout: "120s",
	retry: { maximumAttempts: 3 },
});
const { planReview, completenessCritic, synthesizeReview } = proxyActivities<typeof reviewActivities>({
	startToCloseTimeout: "300s",
	heartbeatTimeout: "30s",
	retry: { maximumAttempts: 3 },
});

export interface PostDecision {
	decision: "post" | "abort";
	decidedBy: string;
}
export const postReviewDecisionSignal = defineSignal<[PostDecision]>("postReviewDecision");

export async function reviewOrchestratorWorkflow(req: ReviewRequest): Promise<ReviewReport> {
	let decision: PostDecision | undefined;
	setHandler(postReviewDecisionSignal, (d) => { decision = d; });

	// 1–2. Fetch + checkout
	const prData = await fetchPullRequest(req.owner, req.repo, req.pr);
	const workingDir = await checkoutPrToWorkspace(req.owner, req.repo, req.pr, prData.meta.headSha, prData.meta.baseSha);
	const pr: PullRequestContext = { ...prData, workingDir };
	const prRef = { owner: req.owner, repo: req.repo, pr: req.pr, headSha: prData.meta.headSha, baseSha: prData.meta.baseSha };

	// 3. Lead agent plans dimensions
	const plan = await planReview(pr, req.providerDefault);
	let dimensions = plan.dimensions;

	const dimensionErrors: Record<string, string> = {};
	const allFindings: Finding[] = [];
	const coveredKeys = new Set<string>();

	// 4–5. Fan-out workers → fan-in (degrade gracefully on failure)
	async function runRound(dims: typeof dimensions): Promise<void> {
		const handles = await Promise.all(
			dims.map((d) =>
				startChild(reviewWorkerWorkflow, {
					args: [{ dimension: d, workingDir, pr: prRef }],
					workflowId: `${workflowInfo().workflowId}-worker-${d.key}-${uuid4()}`,
				}),
			),
		);
		const settled = await Promise.allSettled(handles.map((h: ChildWorkflowHandle<typeof reviewWorkerWorkflow>) => h.result()));
		settled.forEach((r, i) => {
			const key = dims[i].key;
			coveredKeys.add(key);
			if (r.status === "fulfilled") allFindings.push(...(r.value as DimensionFindings).findings);
			else dimensionErrors[key] = String(r.reason);
		});
	}
	await runRound(dimensions);

	// 6b. Optional completeness critic (bounded loop-until-dry, max 1 extra round)
	if (req.completenessCritic) {
		const extra = await completenessCritic(pr, [...coveredKeys], req.providerDefault);
		const fresh = extra.dimensions.filter((d) => !coveredKeys.has(d.key));
		if (fresh.length > 0) { dimensions = fresh; await runRound(fresh); }
	}

	// 6. Verify each finding (fan-out → fan-in), keep majority-real
	const verifyHandles = await Promise.all(
		allFindings.map((f) =>
			startChild(verifyFindingWorkflow, {
				args: [{ finding: f, workingDir, provider: req.providerDefault, verifierCount: VERIFIER_COUNT }],
				workflowId: `${workflowInfo().workflowId}-verify-${f.id}-${uuid4()}`,
			}),
		),
	);
	const verdicts = await Promise.all(verifyHandles.map((h) => h.result()));
	const confirmed: Finding[] = [];
	const dropped: Finding[] = [];
	allFindings.forEach((f, i) => (verdicts[i].real ? confirmed : dropped).push(f));

	// 7. Synthesize
	const report = await synthesizeReview(confirmed, dropped, dimensionErrors, { inputTokens: 0, outputTokens: 0 }, req.minSeverity, req.providerDefault);

	// 8. Optional human gate
	if (req.humanGate) {
		const got = await condition(() => decision !== undefined, "1h");
		if (!got || decision?.decision === "abort") return report;
	}

	// 9. Post back to GitHub
	await postReviewToGitHub(req.owner, req.repo, req.pr, report);
	return report;
}
```

- [ ] **Step 2: Write the orchestrator test (mock activities + child workflows)**

`src/workflows/review-orchestrator.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import type { ReviewRequest } from "../contracts/review.ts";

let testEnv: TestWorkflowEnvironment;
beforeAll(async () => { testEnv = await TestWorkflowEnvironment.createLocal(); }, 30_000);
afterAll(async () => { await testEnv?.teardown(); });

const baseReq: ReviewRequest = { owner: "o", repo: "r", pr: 1, providerDefault: "claude", humanGate: false, minSeverity: "low", completenessCritic: false };
const finding = { id: "f1", dimension: "security", file: "a.ts", line: 3, severity: "high", title: "t", body: "b" };

// Activities mocked to drive the orchestration deterministically.
function activities(overrides: Record<string, unknown> = {}) {
	let posted: unknown = null;
	return {
		posted: () => posted,
		impl: {
			fetchPullRequest: async () => ({
				meta: { owner: "o", repo: "r", pr: 1, title: "PR", headSha: "h", baseSha: "b", author: "a" },
				diff: "diff",
				changedFiles: [{ path: "a.ts", status: "modified", additions: 1, deletions: 0 }],
			}),
			checkoutPrToWorkspace: async () => "/tmp/wd",
			planReview: async () => ({ dimensions: [{ key: "security", rationale: "r", scopePaths: ["a.ts"], provider: "claude" }] }),
			runAgentReview: async () => ({ dimension: "security", findings: [finding], coverageNote: "ok" }),
			verifyFinding: async () => ({ findingId: "f1", real: true, confidence: 0.9 }),
			completenessCritic: async () => ({ dimensions: [] }),
			synthesizeReview: async (confirmed: unknown[]) => ({
				summary: `${(confirmed as unknown[]).length} confirmed`,
				confirmed,
				dropped: [],
				byDimension: { security: (confirmed as unknown[]).length },
				dimensionErrors: {},
				usage: { inputTokens: 0, outputTokens: 0 },
			}),
			postReviewToGitHub: async (_o: string, _r: string, _p: number, report: unknown) => { posted = report; },
			...overrides,
		},
	};
}

async function runWorker(taskQueue: string, impl: Record<string, unknown>, req: ReviewRequest, workflowId: string) {
	const { client, nativeConnection } = testEnv;
	const worker = await Worker.create({
		connection: nativeConnection,
		taskQueue,
		workflowsPath: new URL("./review-orchestrator.ts", import.meta.url).pathname,
		activities: impl,
	});
	return worker.runUntil(client.workflow.execute("reviewOrchestratorWorkflow", { args: [req], workflowId, taskQueue }));
}

describe("reviewOrchestratorWorkflow", () => {
	it("plans, reviews, verifies, synthesizes, and posts confirmed findings", async () => {
		const a = activities();
		const report = await runWorker("test-orch-happy", a.impl, baseReq, "orch-happy");
		expect(report.confirmed).toHaveLength(1);
		expect(a.posted()).not.toBeNull();
	});

	it("drops findings the verifiers refute", async () => {
		const a = activities({ verifyFinding: async () => ({ findingId: "f1", real: false, confidence: 0.2 }) });
		const report = await runWorker("test-orch-drop", a.impl, baseReq, "orch-drop");
		expect(report.confirmed).toHaveLength(0);
		expect(report.dropped).toHaveLength(1);
	});

	it("records a dimensionError and still completes when a worker activity fails", async () => {
		const a = activities({ runAgentReview: async () => { throw new Error("agent boom"); } });
		const report = await runWorker("test-orch-degrade", a.impl, baseReq, "orch-degrade");
		expect(Object.keys(report.dimensionErrors)).toContain("security");
		expect(report.confirmed).toHaveLength(0);
	});
});
```

> Note: `runAgentReview` retries 3× before failing, so the degrade test waits for retries; `TestWorkflowEnvironment` uses time-skipping so this stays fast. If the child-workflow retry slows the test, lower `maximumAttempts` to 1 for `runAgentReview` in `review-worker.ts` or override via test — keep production at 3.

- [ ] **Step 3: Run test**

Run: `bun test src/workflows/review-orchestrator.test.ts`
Expected: PASS (3 tests). Child workflows (`reviewWorkerWorkflow`, `verifyFindingWorkflow`) run on the same worker because they're imported in the same `workflowsPath` bundle.

- [ ] **Step 4: Commit**

```bash
bun run check:fix
git add src/workflows/review-orchestrator.ts src/workflows/review-orchestrator.test.ts
git commit -m "feat: add reviewOrchestratorWorkflow with fan-out/verify/degrade/human-gate"
```

---

## Task 11: Worker process

**Files:**
- Create: `src/workers/review.ts`
- Modify: `package.json` (scripts)

- [ ] **Step 1: Implement the worker**

`src/workers/review.ts` (mirrors `src/workers/greeter.ts`):
```ts
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "@temporalio/worker";
import * as ghActivities from "../activities/github.ts";
import * as reviewActivities from "../activities/review.ts";
import { initTracing, shutdownTracing } from "../telemetry/tracing.ts";
import { createNativeConnection, namespace } from "../temporal-connection.ts";

async function run() {
	initTracing();
	const connection = await createNativeConnection();
	const dir = typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url));
	const ext = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
	const workflowsPath = resolve(dir, `../workflows/review-orchestrator${ext}`);

	const worker = await Worker.create({
		connection,
		namespace,
		taskQueue: "review",
		workflowsPath,
		activities: { ...ghActivities, ...reviewActivities },
	});
	console.log("Worker started on task queue: review");
	await worker.run();
}

run()
	.catch((err) => { console.error("Worker failed:", err); process.exit(1); })
	.finally(() => shutdownTracing());
```

- [ ] **Step 2: Add scripts to package.json**

In `package.json` `scripts`, add:
```json
		"worker:review": "bun run src/workers/review.ts",
		"client:pr-review": "bun run src/clients/run-pr-review.ts",
```
Remove any leftover script entries pointing at deleted workers/clients (ci-pipeline, agent-task, code-review, security-scan, webhook, the demos).

- [ ] **Step 3: Verify the worker bundles**

Run:
```bash
bun run temporal:dev &
sleep 5
timeout 8 bun run worker:review || true
kill %1 2>/dev/null || true
```
Expected: prints `Worker started on task queue: review` with no bundling/import errors, then exits on timeout.

- [ ] **Step 4: Commit**

```bash
bun run check:fix
git add src/workers/review.ts package.json
git commit -m "feat: add review worker binding orchestrator + worker/verify child workflows"
```

---

## Task 12: CLI client

**Files:**
- Create: `src/clients/run-pr-review.ts`

- [ ] **Step 1: Implement the client**

`src/clients/run-pr-review.ts`:
```ts
import { Client } from "@temporalio/client";
import { ReviewRequest } from "../contracts/review.ts";
import { createConnection, namespace } from "../temporal-connection.ts";

function parseArgs(): ReviewRequest {
	const [slug, prStr] = process.argv.slice(2);
	if (!slug || !prStr || !slug.includes("/")) {
		console.error("Usage: bun run client:pr-review <owner>/<repo> <pr> [--human-gate] [--critic] [--min=low|medium|high|critical]");
		process.exit(1);
	}
	const [owner, repo] = slug.split("/");
	const flags = process.argv.slice(4);
	const min = flags.find((f) => f.startsWith("--min="))?.split("=")[1];
	return ReviewRequest.parse({
		owner,
		repo,
		pr: Number.parseInt(prStr, 10),
		humanGate: flags.includes("--human-gate"),
		completenessCritic: flags.includes("--critic"),
		...(min ? { minSeverity: min } : {}),
	});
}

async function run() {
	const req = parseArgs();
	const connection = await createConnection();
	const client = new Client({ connection, namespace });
	const workflowId = `review-${req.owner}-${req.repo}-${req.pr}`;
	console.log(`Starting review ${workflowId} ...`);
	const handle = await client.workflow.start("reviewOrchestratorWorkflow", {
		args: [req],
		taskQueue: "review",
		workflowId,
	});
	console.log(`Workflow started: ${handle.workflowId}. Waiting for result...`);
	const report = await handle.result();
	console.log(`\n=== Review summary ===\n${report.summary}`);
	console.log(`Confirmed: ${report.confirmed.length}, Dropped: ${report.dropped.length}`);
	await connection.close();
}

run().catch((err) => { console.error(err); process.exit(1); });
```

> Verify `createConnection` is exported from `src/temporal-connection.ts` (alongside `createNativeConnection`). If only the native connection exists, add a `Connection.connect`-based `createConnection` there following the same config; check the file first.

- [ ] **Step 2: Smoke-check the client parses args**

Run:
```bash
bun run client:pr-review 2>&1 | head -1
```
Expected: prints the `Usage:` line and exits non-zero (no args).

- [ ] **Step 3: Commit**

```bash
bun run check:fix
git add src/clients/run-pr-review.ts
git commit -m "feat: add run-pr-review CLI client"
```

---

## Task 13: Live integration test + docs

**Files:**
- Create: `src/activities/review.integration.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Write the gated integration test**

`src/activities/review.integration.test.ts`:
```ts
import { describe, expect, it } from "bun:test";

const live = process.env.ANTHROPIC_API_KEY && process.env.GITHUB_TOKEN;
const maybe = live ? describe : describe.skip;

maybe("live review activities", () => {
	it("plans dimensions for a real small PR", async () => {
		const { fetchPullRequest, checkoutPrToWorkspace } = await import("./github.ts");
		const { planReview } = await import("./review.ts");
		const owner = process.env.IT_OWNER ?? "wingnut128";
		const repo = process.env.IT_REPO ?? "orchestrations";
		const pr = Number.parseInt(process.env.IT_PR ?? "49", 10);
		const data = await fetchPullRequest(owner, repo, pr);
		const wd = await checkoutPrToWorkspace(owner, repo, pr, data.meta.headSha, data.meta.baseSha);
		const plan = await planReview({ ...data, workingDir: wd }, "claude");
		expect(plan.dimensions.length).toBeGreaterThan(0);
	}, 120_000);
});
```

- [ ] **Step 2: Run it (skipped without keys)**

Run: `bun test src/activities/review.integration.test.ts`
Expected: `0 pass, 0 fail` with the suite skipped (unless `ANTHROPIC_API_KEY` + `GITHUB_TOKEN` are set).

- [ ] **Step 3: Update README**

Replace the "Available Workflows" / "Agent-to-Agent Communication" sections with the new flow:
- The trigger: `bun run worker:review` then `bun run client:pr-review owner/repo 49`
- The topology: orchestrator → worker child workflows (one per review dimension, each an Agent SDK tool-loop) → adversarial verify child workflows → synthesize → post to GitHub
- The pluggable `AgentRunner` (Claude now; Gemini/Codex are documented extension points)
- Env vars: `GITHUB_TOKEN`, `ANTHROPIC_API_KEY`
- Remove all Forgejo/webhook references.

- [ ] **Step 4: Full green check**

Run: `bun run check && bun test`
Expected: Biome clean; all unit + workflow tests pass; integration suite skipped.

- [ ] **Step 5: Commit**

```bash
git add src/activities/review.integration.test.ts README.md
git commit -m "test: add gated live review integration test; docs: rewrite for PR-review flow"
```

---

## Final verification

- [ ] Run `bun run check && bun test` — all green, integration skipped.
- [ ] Confirm no remaining references to Forgejo, webhook, or the old workflows: `git grep -il forgejo src/ ; git grep -il agent-protocol src/` → no results.
- [ ] Open a PR from `feature/multi-agent-code-review`.
