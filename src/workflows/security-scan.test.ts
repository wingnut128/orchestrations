import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import type { ScanFindings } from "../activities/security-scan.ts";
import type { SecurityScanResult } from "./security-scan.ts";

let testEnv: TestWorkflowEnvironment;

beforeAll(async () => {
	testEnv = await TestWorkflowEnvironment.createLocal();
}, 30_000);

afterAll(async () => {
	await testEnv?.teardown();
});

function createMockActivities(findings: ScanFindings) {
	return {
		scanForVulnerabilities: async (
			_commitSha: string,
			_owner: string,
			_repo: string,
		): Promise<ScanFindings> => findings,
		signalPipelineScanResult: async (
			_pipelineWorkflowId: string,
			_approved: boolean,
			_details: string,
		): Promise<void> => {},
	};
}

describe("securityScanWorkflow", () => {
	it("approves when no critical or high findings", async () => {
		const { client, nativeConnection } = testEnv;
		const taskQueue = "test-scan-clean";

		const worker = await Worker.create({
			connection: nativeConnection,
			taskQueue,
			workflowsPath: new URL("./security-scan.ts", import.meta.url).pathname,
			activities: createMockActivities({
				critical: 0,
				high: 0,
				medium: 2,
				low: 5,
				summary: "No critical or high findings",
			}),
		});

		const result: SecurityScanResult = await worker.runUntil(
			client.workflow.execute("securityScanWorkflow", {
				args: [
					{
						commitSha: "abc123",
						pipelineWorkflowId: "pipeline-1",
						owner: "test",
						repo: "repo",
					},
				],
				workflowId: "test-scan-clean",
				taskQueue,
			}),
		);

		expect(result.approved).toBe(true);
		expect(result.findings).toContain("No critical");
	});

	it("rejects when critical findings exist", async () => {
		const { client, nativeConnection } = testEnv;
		const taskQueue = "test-scan-critical";

		const worker = await Worker.create({
			connection: nativeConnection,
			taskQueue,
			workflowsPath: new URL("./security-scan.ts", import.meta.url).pathname,
			activities: createMockActivities({
				critical: 1,
				high: 0,
				medium: 0,
				low: 0,
				summary: "1 critical: SQL injection in auth handler",
			}),
		});

		const result: SecurityScanResult = await worker.runUntil(
			client.workflow.execute("securityScanWorkflow", {
				args: [
					{
						commitSha: "abc123",
						pipelineWorkflowId: "pipeline-1",
						owner: "test",
						repo: "repo",
					},
				],
				workflowId: "test-scan-critical",
				taskQueue,
			}),
		);

		expect(result.approved).toBe(false);
		expect(result.findings).toContain("SQL injection");
	});

	it("rejects when high findings exist", async () => {
		const { client, nativeConnection } = testEnv;
		const taskQueue = "test-scan-high";

		const worker = await Worker.create({
			connection: nativeConnection,
			taskQueue,
			workflowsPath: new URL("./security-scan.ts", import.meta.url).pathname,
			activities: createMockActivities({
				critical: 0,
				high: 3,
				medium: 1,
				low: 0,
				summary: "3 high severity findings",
			}),
		});

		const result: SecurityScanResult = await worker.runUntil(
			client.workflow.execute("securityScanWorkflow", {
				args: [
					{
						commitSha: "abc123",
						pipelineWorkflowId: "pipeline-1",
						owner: "test",
						repo: "repo",
					},
				],
				workflowId: "test-scan-high",
				taskQueue,
			}),
		);

		expect(result.approved).toBe(false);
	});
});
