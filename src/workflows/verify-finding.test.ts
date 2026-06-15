import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import type { Finding } from "../contracts/review.ts";

let testEnv: TestWorkflowEnvironment;
beforeAll(async () => {
	testEnv = await TestWorkflowEnvironment.createLocal();
}, 30_000);
afterAll(async () => {
	await testEnv?.teardown();
});

const finding: Finding = {
	id: "f1",
	dimension: "security",
	file: "a.ts",
	severity: "high",
	title: "t",
	body: "b",
};

describe("verifyFindingWorkflow", () => {
	it("returns the verdict from the activity", async () => {
		const { client, nativeConnection } = testEnv;
		const taskQueue = "test-verify";
		const worker = await Worker.create({
			connection: nativeConnection,
			taskQueue,
			workflowsPath: new URL("./verify-finding.ts", import.meta.url).pathname,
			activities: {
				verifyFinding: async () => ({
					findingId: "f1",
					real: true,
					confidence: 0.9,
				}),
			},
		});
		const result = await worker.runUntil(
			client.workflow.execute("verifyFindingWorkflow", {
				args: [
					{ finding, workingDir: "/tmp", provider: "claude", verifierCount: 3 },
				],
				workflowId: "test-verify-1",
				taskQueue,
			}),
		);
		expect(result).toEqual({ findingId: "f1", real: true, confidence: 0.9 });
	});
});
