import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "../activities/code-review.ts";

const { fetchDiff, reviewDiff, signalPipelineReview } = proxyActivities<
	typeof activities
>({
	startToCloseTimeout: "120s",
});

export interface CodeReviewInput {
	commitSha: string;
	pipelineWorkflowId: string;
	owner?: string;
	repo?: string;
}

export interface CodeReviewResult {
	commitSha: string;
	approved: boolean;
	feedback: string;
}

export async function codeReviewWorkflow(
	input: CodeReviewInput,
): Promise<CodeReviewResult> {
	const { commitSha, pipelineWorkflowId, owner, repo } = input;

	// Step 1: Fetch the diff for this commit from Forgejo
	const diff = await fetchDiff(commitSha, owner, repo);

	// Step 2: Ask Claude to review the diff
	const review = await reviewDiff(diff);

	// Step 3: Signal the CI pipeline workflow with the review result
	await signalPipelineReview(
		pipelineWorkflowId,
		review.approved,
		review.feedback,
	);

	return {
		commitSha,
		approved: review.approved,
		feedback: review.feedback,
	};
}
