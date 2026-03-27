import { Client } from "@temporalio/client";
import {
	agentResultSignal,
	deployApprovalSignal,
} from "../signals/agent-protocol.ts";
import { createConnection, namespace } from "../temporal-connection.ts";
import { getPipelineStateQuery } from "../workflows/ci-pipeline.ts";

async function run() {
	const connection = await createConnection();
	const client = new Client({ connection, namespace });

	const commitSha = "a1b2c3d4e5f6";
	const workflowId = `ci-pipeline-${commitSha}-${Date.now()}`;

	// Start the workflow (non-blocking — we want to interact with it via signals)
	const handle = await client.workflow.start("ciPipelineWorkflow", {
		taskQueue: "ci-pipeline",
		workflowId,
		args: [{ commitSha, owner: "demo", repo: "demo-repo" }],
	});

	console.log(`Started CI pipeline workflow: ${workflowId}`);

	// Poll until the workflow reaches "awaiting-agent-results"
	await waitForStage(handle, "awaiting-agent-results");
	console.log(
		"Pipeline is awaiting agent results. Sending approval signals...",
	);

	// Simulate: agents signal approval
	await handle.signal(agentResultSignal, {
		agentType: "code-review",
		approved: true,
		agent: "review-bot",
	});
	await handle.signal(agentResultSignal, {
		agentType: "security-scan",
		approved: true,
		agent: "scan-bot",
	});
	console.log("Agent result signals sent.");

	// Poll until the workflow reaches "awaiting-deploy-approval"
	await waitForStage(handle, "awaiting-deploy-approval");
	console.log(
		"Pipeline is awaiting deploy approval. Sending approval signal...",
	);

	// Simulate: a deploy-approval agent signals that deployment is approved
	await handle.signal(deployApprovalSignal, {
		approved: true,
		approver: "deploy-bot",
	});
	console.log("Deploy approval signal sent.");

	// Wait for the workflow to complete and get the final result
	const result = await handle.result();
	console.log("\nPipeline completed!");
	console.log(JSON.stringify(result, null, 2));
}

async function waitForStage(
	handle: Awaited<ReturnType<Client["workflow"]["start"]>>,
	targetStage: string,
): Promise<void> {
	const maxAttempts = 30;
	for (let i = 0; i < maxAttempts; i++) {
		const state = await handle.query(getPipelineStateQuery);
		if (state.stage === targetStage) return;
		if (state.stage === "failed" || state.stage === "completed") {
			throw new Error(`Workflow ended unexpectedly in stage: ${state.stage}`);
		}
		// Wait 1 second before polling again
		await new Promise((resolve) => setTimeout(resolve, 1_000));
	}
	throw new Error(`Timed out waiting for stage: ${targetStage}`);
}

run().catch((err) => {
	console.error("Client failed:", err);
	process.exit(1);
});
