import { Client } from "@temporalio/client";
import { createConnection, namespace } from "../temporal-connection.ts";
import {
	deployApprovalSignal,
	getPipelineStateQuery,
} from "../workflows/ci-pipeline.ts";

async function run() {
	const connection = await createConnection();
	const client = new Client({ connection, namespace });

	const commitSha = "a1b2c3d4e5f6";
	const pipelineWorkflowId = `ci-pipeline-${commitSha}-${Date.now()}`;
	const reviewWorkflowId = `code-review-${commitSha}-${Date.now()}`;

	// Step 1: Start the CI pipeline workflow
	const pipelineHandle = await client.workflow.start("ciPipelineWorkflow", {
		taskQueue: "ci-pipeline",
		workflowId: pipelineWorkflowId,
		args: [{ commitSha, owner: "demo", repo: "demo-repo" }],
	});
	console.log(`Started CI pipeline workflow: ${pipelineWorkflowId}`);

	// Step 2: Wait for the pipeline to reach "awaiting-code-review"
	await waitForStage(pipelineHandle, "awaiting-code-review");
	console.log(
		"Pipeline is awaiting code review. Starting code-review workflow...",
	);

	// Step 3: Start the code-review workflow, passing the pipeline's workflowId
	const reviewHandle = await client.workflow.start("codeReviewWorkflow", {
		taskQueue: "code-review",
		workflowId: reviewWorkflowId,
		args: [{ commitSha, pipelineWorkflowId, owner: "demo", repo: "demo-repo" }],
	});
	console.log(`Started code-review workflow: ${reviewWorkflowId}`);

	// Step 4: Wait for the code-review workflow to complete
	const reviewResult = await reviewHandle.result();
	console.log("\nCode review completed!");
	console.log(`  Approved: ${reviewResult.approved}`);
	console.log(`  Feedback: ${reviewResult.feedback}`);

	// Step 5: Check the pipeline state — it should have moved past code review
	const stateAfterReview = await pipelineHandle.query(getPipelineStateQuery);
	console.log(`\nPipeline stage after review: ${stateAfterReview.stage}`);

	if (stateAfterReview.stage === "failed") {
		console.log(`Pipeline failed: ${stateAfterReview.error}`);
		const finalResult = await pipelineHandle.result();
		console.log("\nFinal pipeline state:");
		console.log(JSON.stringify(finalResult, null, 2));
		return;
	}

	// Step 6: If review was approved, send deploy approval to complete the pipeline
	if (stateAfterReview.stage === "awaiting-deploy-approval") {
		console.log("Sending deploy approval...");
		await pipelineHandle.signal(deployApprovalSignal, {
			approved: true,
			approver: "demo-client",
		});
		console.log("Deploy approval signal sent.");
	}

	// Step 7: Wait for the pipeline to complete and print final state
	const finalResult = await pipelineHandle.result();
	console.log("\nFinal pipeline state:");
	console.log(JSON.stringify(finalResult, null, 2));
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
		await new Promise((resolve) => setTimeout(resolve, 1_000));
	}
	throw new Error(`Timed out waiting for stage: ${targetStage}`);
}

run().catch((err) => {
	console.error("Client failed:", err);
	process.exit(1);
});
