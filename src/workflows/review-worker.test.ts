import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import type { ReviewDimension } from "../contracts/review.ts";

let testEnv: TestWorkflowEnvironment;
beforeAll(async () => {
	testEnv = await TestWorkflowEnvironment.createLocal();
}, 30_000);
afterAll(async () => {
	await testEnv?.teardown();
});

const dimension: ReviewDimension = {
	key: "security",
	rationale: "r",
	scopePaths: ["a.ts"],
	provider: "claude",
};

describe("reviewWorkerWorkflow", () => {
	it("returns the dimension findings from the activity", async () => {
		const { client, nativeConnection } = testEnv;
		const taskQueue = "test-worker";
		const findings = {
			dimension: "security",
			findings: [],
			coverageNote: "ok",
		};
		const worker = await Worker.create({
			connection: nativeConnection,
			taskQueue,
			workflowsPath: new URL("./review-worker.ts", import.meta.url).pathname,
			activities: { runAgentReview: async () => findings },
		});
		const result = await worker.runUntil(
			client.workflow.execute("reviewWorkerWorkflow", {
				args: [
					{
						dimension,
						workingDir: "/tmp",
						pr: { owner: "o", repo: "r", pr: 1, headSha: "h", baseSha: "b" },
					},
				],
				workflowId: "test-worker-1",
				taskQueue,
			}),
		);
		expect(result).toEqual(findings);
	});
});
