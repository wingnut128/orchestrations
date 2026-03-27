import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "../activities/code-review.ts";

const { fetchDiff, reviewDiff, signalPipelineReview } = proxyActivities<
	typeof activities
>({
	startToCloseTimeout: "120s",
});

export interface CodeReviewResult {
	commitSha: string;
	approved: boolean;
	feedback: string;
}

export async function codeReviewWorkflow(
	commitSha: string,
	pipelineWorkflowId: string,
): Promise<CodeReviewResult> {
	// Step 1: Fetch the diff for this commit
	const diff = await fetchDiff(commitSha);

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
