import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { WorkflowFailedError } from "@temporalio/client";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { ApplicationFailure } from "@temporalio/workflow";

let testEnv: TestWorkflowEnvironment;

beforeAll(async () => {
	testEnv = await TestWorkflowEnvironment.createLocal();
}, 30_000);

afterAll(async () => {
	await testEnv?.teardown();
});

describe("agentTaskWorkflow", () => {
	it("returns the mocked Claude agent response", async () => {
		const { client, nativeConnection } = testEnv;
		const taskQueue = "test-agent-happy";

		const worker = await Worker.create({
			connection: nativeConnection,
			taskQueue,
			workflowsPath: new URL("./agent-task.ts", import.meta.url).pathname,
			activities: {
				claudeAgent: async (_task: string) =>
					"This is a mocked Claude response.",
			},
		});

		const result = await worker.runUntil(
			client.workflow.execute("agentTaskWorkflow", {
				args: ["Summarize this document"],
				workflowId: "test-agent-happy-path",
				taskQueue,
			}),
		);

		expect(result).toBe("This is a mocked Claude response.");
	});

	it("propagates activity failure to the workflow", async () => {
		const { client, nativeConnection } = testEnv;
		const taskQueue = "test-agent-failure";

		const worker = await Worker.create({
			connection: nativeConnection,
			taskQueue,
			workflowsPath: new URL("./agent-task.ts", import.meta.url).pathname,
			activities: {
				claudeAgent: async (_task: string) => {
					throw ApplicationFailure.nonRetryable("Claude API is down");
				},
			},
		});

		try {
			await worker.runUntil(
				client.workflow.execute("agentTaskWorkflow", {
					args: ["Do something"],
					workflowId: "test-agent-failure-path",
					taskQueue,
				}),
			);
			// Should not reach here
			expect(true).toBe(false);
		} catch (err) {
			expect(err).toBeInstanceOf(WorkflowFailedError);
			const wfErr = err as WorkflowFailedError;
			// WorkflowFailedError -> cause (ActivityFailure) -> cause (ApplicationFailure)
			const rootCause = wfErr.cause?.cause;
			expect(rootCause?.message).toContain("Claude API is down");
		}
	});
});
