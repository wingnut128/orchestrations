import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import type {
	BuildResult,
	CodeReviewResult,
	DeployResult,
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
	requestCodeReview?: (commitSha: string) => Promise<CodeReviewResult>;
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

describe("ciPipelineWorkflow", () => {
	it("completes the full pipeline with signals", async () => {
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
				args: [COMMIT_SHA],
				workflowId: "test-ci-happy-path",
				taskQueue,
			});

			// Wait for the workflow to reach awaiting-code-review
			let state: PipelineState;
			do {
				await sleep(100);
				state = await handle.query("getPipelineState");
			} while (
				state.stage !== "awaiting-code-review" &&
				state.stage !== "failed" &&
				state.stage !== "completed"
			);
			expect(state.stage).toBe("awaiting-code-review");

			// Send code review approval signal
			await handle.signal("codeReviewComplete", {
				approved: true,
				reviewer: "alice",
			});

			// Wait for the workflow to reach awaiting-deploy-approval
			do {
				await sleep(100);
				state = await handle.query("getPipelineState");
			} while (
				state.stage !== "awaiting-deploy-approval" &&
				state.stage !== "failed" &&
				state.stage !== "completed"
			);
			expect(state.stage).toBe("awaiting-deploy-approval");

			// Send deploy approval signal
			await handle.signal("deployApproval", {
				approved: true,
				approver: "bob",
			});

			return await handle.result();
		});

		expect(result.stage).toBe("completed");
		expect(result.buildResult?.success).toBe(true);
		expect(result.testResult?.success).toBe(true);
		expect(result.codeReview?.approved).toBe(true);
		expect(result.codeReview?.reviewer).toBe("alice");
		expect(result.deployApproval?.approved).toBe(true);
		expect(result.deployResult?.success).toBe(true);
	});

	it("fails when code review is rejected", async () => {
		const { client, nativeConnection } = testEnv;
		const taskQueue = "test-ci-rejected";

		const worker = await Worker.create({
			connection: nativeConnection,
			taskQueue,
			workflowsPath: new URL("./ci-pipeline.ts", import.meta.url).pathname,
			activities: createMockActivities(),
		});

		const result = await worker.runUntil(async () => {
			const handle = await client.workflow.start("ciPipelineWorkflow", {
				args: [COMMIT_SHA],
				workflowId: "test-ci-review-rejected",
				taskQueue,
			});

			// Wait for code review stage
			let state: PipelineState;
			do {
				await sleep(100);
				state = await handle.query("getPipelineState");
			} while (
				state.stage !== "awaiting-code-review" &&
				state.stage !== "failed" &&
				state.stage !== "completed"
			);

			// Reject the code review
			await handle.signal("codeReviewComplete", {
				approved: false,
				reviewer: "charlie",
			});

			return await handle.result();
		});

		expect(result.stage).toBe("failed");
		expect(result.error).toContain("rejected by charlie");
	});

	it("reports correct stage via query at each point", async () => {
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
				args: [COMMIT_SHA],
				workflowId: "test-ci-query-stages",
				taskQueue,
			});

			// Poll for awaiting-code-review (build and test happen fast with mocks)
			let state: PipelineState;
			do {
				state = await handle.query("getPipelineState");
				if (!stages.includes(state.stage)) {
					stages.push(state.stage);
				}
			} while (
				state.stage !== "awaiting-code-review" &&
				state.stage !== "failed"
			);

			// Approve code review
			await handle.signal("codeReviewComplete", {
				approved: true,
				reviewer: "dave",
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
		// We should have observed at least these stages
		expect(stages).toContain("awaiting-code-review");
		expect(stages).toContain("awaiting-deploy-approval");
	});
});
