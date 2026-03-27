import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";

let testEnv: TestWorkflowEnvironment;

beforeAll(async () => {
	testEnv = await TestWorkflowEnvironment.createLocal();
}, 30_000);

afterAll(async () => {
	await testEnv?.teardown();
});

describe("greeterWorkflow", () => {
	it("returns a greeting from the mocked greet activity", async () => {
		const { client, nativeConnection } = testEnv;
		const taskQueue = "test-greeter";

		const worker = await Worker.create({
			connection: nativeConnection,
			taskQueue,
			workflowsPath: new URL("./greeter.ts", import.meta.url).pathname,
			activities: {
				greet: async (name: string) => `Mocked hello, ${name}!`,
			},
		});

		const result = await worker.runUntil(
			client.workflow.execute("greeterWorkflow", {
				args: ["World"],
				workflowId: "test-greeter-happy",
				taskQueue,
			}),
		);

		expect(result).toBe("Mocked hello, World!");
	});
});
