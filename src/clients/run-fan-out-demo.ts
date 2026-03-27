import { Client } from "@temporalio/client";
import {
	agentResultSignal,
	deployApprovalSignal,
} from "../signals/agent-protocol.ts";
import { createConnection, namespace } from "../temporal-connection.ts";
import {
	getPipelineStateQuery,
	type PipelineState,
} from "../workflows/ci-pipeline.ts";

async function run() {
	const connection = await createConnection();
	const client = new Client({ connection, namespace });

	const commitSha = "a1b2c3d4e5f6";
	const pipelineWorkflowId = `ci-pipeline-${commitSha}-${Date.now()}`;

	// Step 1: Start the CI pipeline
	const handle = await client.workflow.start("ciPipelineWorkflow", {
		taskQueue: "ci-pipeline",
		workflowId: pipelineWorkflowId,
		args: [{ commitSha, owner: "demo", repo: "demo-repo" }],
	});
	console.log(`Started CI pipeline: ${pipelineWorkflowId}`);

	// Step 2: Wait for agent fan-out stage
	await waitForStage(handle, "awaiting-agent-results");
	console.log("\nPipeline is awaiting agent results (fan-out complete).");
	console.log("Both code-review and security-scan agents are working...\n");

	// Step 3: Simulate agents reporting back (with delay to show fan-in)
	console.log("  [security-scan] Reporting: approved");
	await handle.signal(agentResultSignal, {
		agentType: "security-scan",
		approved: true,
		agent: "security-scan-agent",
		details: "No critical or high findings",
	});

	// Small delay to demonstrate partial fan-in
	await sleep(1_000);

	const midState = await handle.query(getPipelineStateQuery);
	console.log(
		`  Pipeline stage: ${midState.stage} (waiting for code-review...)`,
	);

	console.log("  [code-review] Reporting: approved");
	await handle.signal(agentResultSignal, {
		agentType: "code-review",
		approved: true,
		agent: "claude-review-agent",
		details: "Code looks good, no issues found",
	});

	// Step 4: Wait for deploy approval stage
	await waitForStage(handle, "awaiting-deploy-approval");
	console.log("\nAll agents approved! Pipeline awaiting deploy approval.");

	const stateBeforeDeploy = await handle.query(getPipelineStateQuery);
	console.log("\nAgent results:");
	for (const [agentType, result] of Object.entries(
		stateBeforeDeploy.agentResults,
	)) {
		console.log(
			`  ${agentType}: ${result.approved ? "approved" : "rejected"} — ${result.details ?? "no details"}`,
		);
	}

	// Step 5: Approve deployment
	console.log("\nSending deploy approval...");
	await handle.signal(deployApprovalSignal, {
		approved: true,
		approver: "demo-client",
	});

	// Step 6: Wait for completion
	const finalResult = await handle.result();
	console.log("\nFinal pipeline state:");
	console.log(JSON.stringify(finalResult, null, 2));
}

async function waitForStage(
	handle: Awaited<ReturnType<Client["workflow"]["start"]>>,
	targetStage: string,
): Promise<void> {
	const maxAttempts = 30;
	for (let i = 0; i < maxAttempts; i++) {
		const state: PipelineState = await handle.query(getPipelineStateQuery);
		if (state.stage === targetStage) return;
		if (state.stage === "failed" || state.stage === "completed") {
			throw new Error(`Workflow ended unexpectedly in stage: ${state.stage}`);
		}
		await sleep(1_000);
	}
	throw new Error(`Timed out waiting for stage: ${targetStage}`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

run().catch((err) => {
	console.error("Client failed:", err);
	process.exit(1);
});
