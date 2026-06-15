import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import type { ReviewRequest } from "../contracts/review.ts";

let testEnv: TestWorkflowEnvironment;
beforeAll(async () => {
	testEnv = await TestWorkflowEnvironment.createLocal();
}, 30_000);
afterAll(async () => {
	await testEnv?.teardown();
});

const baseReq: ReviewRequest = {
	owner: "o",
	repo: "r",
	pr: 1,
	providerDefault: "claude",
	humanGate: false,
	minSeverity: "low",
	completenessCritic: false,
};
const finding = {
	id: "f1",
	dimension: "security",
	file: "a.ts",
	line: 3,
	severity: "high",
	title: "t",
	body: "b",
};

// Activities mocked to drive the orchestration deterministically.
function activities(overrides: Record<string, unknown> = {}) {
	let posted: unknown = null;
	return {
		posted: () => posted,
		impl: {
			fetchPullRequest: async () => ({
				meta: {
					owner: "o",
					repo: "r",
					pr: 1,
					title: "PR",
					headSha: "h",
					baseSha: "b",
					author: "a",
				},
				diff: "diff",
				changedFiles: [
					{ path: "a.ts", status: "modified", additions: 1, deletions: 0 },
				],
			}),
			checkoutPrToWorkspace: async () => "/tmp/wd",
			planReview: async () => ({
				plan: {
					dimensions: [
						{
							key: "security",
							rationale: "r",
							scopePaths: ["a.ts"],
							provider: "claude",
						},
					],
				},
				usage: { inputTokens: 1, outputTokens: 1 },
			}),
			runAgentReview: async () => ({
				findings: {
					dimension: "security",
					findings: [finding],
					coverageNote: "ok",
				},
				usage: { inputTokens: 2, outputTokens: 2 },
			}),
			verifyFinding: async () => ({
				verdict: { findingId: "f1", real: true, confidence: 0.9 },
				usage: { inputTokens: 3, outputTokens: 3 },
			}),
			completenessCritic: async () => ({
				plan: { dimensions: [] },
				usage: { inputTokens: 0, outputTokens: 0 },
			}),
			synthesizeReview: async (
				confirmed: unknown[],
				dropped: unknown[],
				dimensionErrors: Record<string, string>,
				priorUsage: { inputTokens: number; outputTokens: number },
			) => ({
				summary: `${confirmed.length} confirmed`,
				confirmed,
				dropped,
				byDimension: { security: confirmed.length },
				dimensionErrors,
				usage: priorUsage,
			}),
			postReviewToGitHub: async (
				_o: string,
				_r: string,
				_p: number,
				report: unknown,
			) => {
				posted = report;
			},
			...overrides,
		},
	};
}

async function runWorker(
	taskQueue: string,
	impl: Record<string, unknown>,
	req: ReviewRequest,
	workflowId: string,
) {
	const { client, nativeConnection } = testEnv;
	const worker = await Worker.create({
		connection: nativeConnection,
		taskQueue,
		workflowsPath: new URL("./review-orchestrator.ts", import.meta.url)
			.pathname,
		activities: impl,
	});
	return worker.runUntil(
		client.workflow.execute("reviewOrchestratorWorkflow", {
			args: [req],
			workflowId,
			taskQueue,
		}),
	);
}

describe("reviewOrchestratorWorkflow", () => {
	it("plans, reviews, verifies, synthesizes, and posts confirmed findings", async () => {
		const a = activities();
		const report = await runWorker(
			"test-orch-happy",
			a.impl,
			baseReq,
			"orch-happy",
		);
		expect(report.confirmed).toHaveLength(1);
		expect(a.posted()).not.toBeNull();
		// usage accumulated: plan {1,1} + worker {2,2} + verify {3,3}
		expect(report.usage).toEqual({ inputTokens: 6, outputTokens: 6 });
	});

	it("drops findings the verifiers refute", async () => {
		const a = activities({
			verifyFinding: async () => ({
				verdict: { findingId: "f1", real: false, confidence: 0.2 },
				usage: { inputTokens: 3, outputTokens: 3 },
			}),
		});
		const report = await runWorker(
			"test-orch-drop",
			a.impl,
			baseReq,
			"orch-drop",
		);
		expect(report.confirmed).toHaveLength(0);
		expect(report.dropped).toHaveLength(1);
	});

	it("records a dimensionError and still completes when a worker activity fails", async () => {
		const a = activities({
			runAgentReview: async () => {
				throw new Error("agent boom");
			},
		});
		const report = await runWorker(
			"test-orch-degrade",
			a.impl,
			baseReq,
			"orch-degrade",
		);
		expect(Object.keys(report.dimensionErrors)).toContain("security");
		expect(report.confirmed).toHaveLength(0);
	});
});
