import { Context } from "@temporalio/activity";
import type { AgentRunner } from "../agents/runner.ts";
import { getRunner } from "../agents/runner.ts";
import { coreTools } from "../agents/tools/index.ts";
import {
	AgentReviewPlan,
	DimensionFindings,
	dimensionFindingsJsonSchema,
	type Finding,
	type Provider,
	type ReviewPlan,
	type ReviewReport,
	reviewPlanJsonSchema,
	SEVERITY_ORDER,
	type Severity,
	Verdict,
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

export async function planReview(
	pr: PullRequestContext,
	providerDefault: Provider,
): Promise<ReviewPlan> {
	const runner = await getRunner(providerDefault);
	const filesList = pr.changedFiles
		.map((f) => `${f.path} (+${f.additions}/-${f.deletions})`)
		.join("\n");
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
	return {
		dimensions: plan.dimensions.map((d) => ({
			...d,
			provider: providerDefault,
		})),
	};
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

export async function runAgentReview(
	dimension: ReviewPlan["dimensions"][number],
	workingDir: string,
	pr: PrRef,
): Promise<DimensionFindings> {
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
	return {
		findingId: finding.id,
		real,
		confidence: avg,
		refutation: real ? undefined : verdicts.find((v) => !v.real)?.refutation,
	};
}

export async function verifyFinding(
	finding: Finding,
	workingDir: string,
	provider: Provider,
	verifierCount: number,
): Promise<Verdict> {
	const runner = await getRunner(provider);
	return verifyFindingWith(
		runner,
		finding,
		workingDir,
		verifierCount,
		heartbeat,
	);
}

// ---- completenessCritic ----

export async function completenessCritic(
	pr: PullRequestContext,
	covered: string[],
	provider: Provider,
): Promise<ReviewPlan> {
	const runner = await getRunner(provider);
	const out = await runner.run({
		systemPrompt:
			"You are a completeness critic. Identify changed files or risks that the already-covered dimensions missed. Return ONLY new dimensions worth running; return an empty list if coverage is complete.",
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
	const filtered = confirmed.filter((f) =>
		meetsSeverity(f.severity, minSeverity),
	);
	const out = await runner.run({
		systemPrompt:
			"You are the review synthesizer. Write a concise human-readable summary of the confirmed findings for a PR author.",
		task: `Confirmed findings:\n${JSON.stringify(filtered)}`,
		tools: [],
		outputSchema: {
			type: "object",
			properties: { summary: { type: "string" } },
			required: ["summary"],
		},
		workingDir: "/tmp",
		onProgress,
	});
	const summary = (out.output as { summary: string }).summary;
	const byDimension: Record<string, number> = {};
	for (const f of filtered)
		byDimension[f.dimension] = (byDimension[f.dimension] ?? 0) + 1;
	return {
		summary,
		confirmed: filtered,
		dropped,
		byDimension,
		dimensionErrors,
		usage,
	};
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
	return synthesizeReviewWith(
		runner,
		confirmed,
		dropped,
		dimensionErrors,
		usage,
		minSeverity,
		heartbeat,
	);
}
