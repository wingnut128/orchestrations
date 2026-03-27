import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import type {
	BuildResult,
	CodeReviewResult,
	DeployResult,
	SecurityScanResult,
	TestResult,
} from "../activities/ci-pipeline.ts";
import type { PipelineState } from "./ci-pipeline.ts";

let testEnv: TestWorkflowEnvironment;

beforeAll(async () => {
	testEnv = await TestWorkflowEnvironment.createLocal();
}, 30_000);

afterAll(async () => {
	await testEnv?.teardown();
});

const COMMIT_SHA = "abc1234567890";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function createMockActivities(overrides?: {
	build?: (commitSha: string) => Promise<BuildResult>;
	test?: (artifactUrl: string) => Promise<TestResult>;
	requestCodeReview?: (
		commitSha: string,
		pipelineWorkflowId: string,
		owner: string,
		repo: string,
	) => Promise<CodeReviewResult>;
	requestSecurityScan?: (
		commitSha: string,
		pipelineWorkflowId: string,
		owner: string,
		repo: string,
	) => Promise<SecurityScanResult>;
	deploy?: (artifactUrl: string, environment: string) => Promise<DeployResult>;
}) {
	return {
		build:
			overrides?.build ??
			(async (_commitSha: string): Promise<BuildResult> => ({
				success: true,
				artifactUrl: `https://artifacts.example.com/${_commitSha}.tar.gz`,
				durationMs: 1000,
			})),
		test:
			overrides?.test ??
			(async (_artifactUrl: string): Promise<TestResult> => ({
				success: true,
				passed: 10,
				failed: 0,
				skipped: 0,
			})),
		requestCodeReview:
			overrides?.requestCodeReview ??
			(async (_commitSha: string): Promise<CodeReviewResult> => ({
				reviewId: `review-${_commitSha.slice(0, 7)}`,
				status: "pending",
			})),
		requestSecurityScan:
			overrides?.requestSecurityScan ??
			(async (_commitSha: string): Promise<SecurityScanResult> => ({
				scanId: `scan-${_commitSha.slice(0, 7)}`,
				status: "pending",
			})),
		deploy:
			overrides?.deploy ??
			(async (
				_artifactUrl: string,
				environment: string,
			): Promise<DeployResult> => ({
				success: true,
				environment,
				deploymentUrl: `https://${environment}.example.com`,
			})),
	};
}

async function waitForStage(
	handle: Awaited<
		ReturnType<TestWorkflowEnvironment["client"]["workflow"]["start"]>
	>,
	targetStage: string,
	maxAttempts = 50,
): Promise<PipelineState> {
	for (let i = 0; i < maxAttempts; i++) {
		await sleep(100);
		const state: PipelineState = await handle.query("getPipelineState");
		if (
			state.stage === targetStage ||
			state.stage === "failed" ||
			state.stage === "completed"
		) {
			return state;
		}
	}
	throw new Error(`Timed out waiting for stage: ${targetStage}`);
}

describe("ciPipelineWorkflow", () => {
	it("completes the full pipeline with fan-out/fan-in agent signals", async () => {
		const { client, nativeConnection } = testEnv;
		const taskQueue = "test-ci-happy";

		const worker = await Worker.create({
			connection: nativeConnection,
			taskQueue,
			workflowsPath: new URL("./ci-pipeline.ts", import.meta.url).pathname,
			activities: createMockActivities(),
		});

		const result = await worker.runUntil(async () => {
			const handle = await client.workflow.start("ciPipelineWorkflow", {
				args: [{ commitSha: COMMIT_SHA, owner: "testuser", repo: "testrepo" }],
				workflowId: "test-ci-happy-path",
				taskQueue,
			});

			// Wait for fan-out stage
			const state = await waitForStage(handle, "awaiting-agent-results");
			expect(state.stage).toBe("awaiting-agent-results");

			// Both agents signal back approval
			await handle.signal("agentResult", {
				agentType: "code-review",
				approved: true,
				agent: "alice",
				details: "Looks good",
			});
			await handle.signal("agentResult", {
				agentType: "security-scan",
				approved: true,
				agent: "scanner",
				details: "No issues found",
			});

			// Wait for deploy approval stage
			const stateAfterAgents = await waitForStage(
				handle,
				"awaiting-deploy-approval",
			);
			expect(stateAfterAgents.stage).toBe("awaiting-deploy-approval");

			// Send deploy approval
			await handle.signal("deployApproval", {
				approved: true,
				approver: "bob",
			});

			return await handle.result();
		});

		expect(result.stage).toBe("completed");
		expect(result.buildResult?.success).toBe(true);
		expect(result.testResult?.success).toBe(true);
		expect(result.agentResults["code-review"].approved).toBe(true);
		expect(result.agentResults["security-scan"].approved).toBe(true);
		expect(result.deployApproval?.approved).toBe(true);
		expect(result.deployResult?.success).toBe(true);
	});

	it("fails when one agent rejects", async () => {
		const { client, nativeConnection } = testEnv;
		const taskQueue = "test-ci-partial-reject";

		const worker = await Worker.create({
			connection: nativeConnection,
			taskQueue,
			workflowsPath: new URL("./ci-pipeline.ts", import.meta.url).pathname,
			activities: createMockActivities(),
		});

		const result = await worker.runUntil(async () => {
			const handle = await client.workflow.start("ciPipelineWorkflow", {
				args: [{ commitSha: COMMIT_SHA, owner: "testuser", repo: "testrepo" }],
				workflowId: "test-ci-partial-reject",
				taskQueue,
			});

			await waitForStage(handle, "awaiting-agent-results");

			// Code review approves, security scan rejects
			await handle.signal("agentResult", {
				agentType: "code-review",
				approved: true,
				agent: "alice",
			});
			await handle.signal("agentResult", {
				agentType: "security-scan",
				approved: false,
				agent: "scanner",
				details: "Critical vulnerability found",
			});

			return await handle.result();
		});

		expect(result.stage).toBe("failed");
		expect(result.error).toContain("security-scan");
	});

	it("handles agents reporting in reverse order", async () => {
		const { client, nativeConnection } = testEnv;
		const taskQueue = "test-ci-reverse-order";

		const worker = await Worker.create({
			connection: nativeConnection,
			taskQueue,
			workflowsPath: new URL("./ci-pipeline.ts", import.meta.url).pathname,
			activities: createMockActivities(),
		});

		const result = await worker.runUntil(async () => {
			const handle = await client.workflow.start("ciPipelineWorkflow", {
				args: [{ commitSha: COMMIT_SHA, owner: "testuser", repo: "testrepo" }],
				workflowId: "test-ci-reverse-order",
				taskQueue,
			});

			await waitForStage(handle, "awaiting-agent-results");

			// Security scan reports first, then code review
			await handle.signal("agentResult", {
				agentType: "security-scan",
				approved: true,
				agent: "scanner",
			});

			// Pipeline should still be waiting (code-review hasn't reported)
			await sleep(200);
			const midState: PipelineState = await handle.query("getPipelineState");
			expect(midState.stage).toBe("awaiting-agent-results");

			await handle.signal("agentResult", {
				agentType: "code-review",
				approved: true,
				agent: "alice",
			});

			// Now send deploy approval
			await waitForStage(handle, "awaiting-deploy-approval");
			await handle.signal("deployApproval", {
				approved: true,
				approver: "bob",
			});

			return await handle.result();
		});

		expect(result.stage).toBe("completed");
	});

	it("reports correct stages via query", async () => {
		const { client, nativeConnection } = testEnv;
		const taskQueue = "test-ci-query";

		const stages: string[] = [];

		const worker = await Worker.create({
			connection: nativeConnection,
			taskQueue,
			workflowsPath: new URL("./ci-pipeline.ts", import.meta.url).pathname,
			activities: createMockActivities(),
		});

		const result = await worker.runUntil(async () => {
			const handle = await client.workflow.start("ciPipelineWorkflow", {
				args: [{ commitSha: COMMIT_SHA, owner: "testuser", repo: "testrepo" }],
				workflowId: "test-ci-query-stages",
				taskQueue,
			});

			// Poll for awaiting-agent-results
			let state: PipelineState;
			do {
				state = await handle.query("getPipelineState");
				if (!stages.includes(state.stage)) {
					stages.push(state.stage);
				}
			} while (
				state.stage !== "awaiting-agent-results" &&
				state.stage !== "failed"
			);

			// Approve both agents
			await handle.signal("agentResult", {
				agentType: "code-review",
				approved: true,
				agent: "dave",
			});
			await handle.signal("agentResult", {
				agentType: "security-scan",
				approved: true,
				agent: "scanner",
			});

			// Poll for awaiting-deploy-approval
			do {
				state = await handle.query("getPipelineState");
				if (!stages.includes(state.stage)) {
					stages.push(state.stage);
				}
			} while (
				state.stage !== "awaiting-deploy-approval" &&
				state.stage !== "failed"
			);

			// Approve deploy
			await handle.signal("deployApproval", {
				approved: true,
				approver: "eve",
			});

			return await handle.result();
		});

		expect(result.stage).toBe("completed");
		expect(stages).toContain("awaiting-agent-results");
		expect(stages).toContain("awaiting-deploy-approval");
	});
});
