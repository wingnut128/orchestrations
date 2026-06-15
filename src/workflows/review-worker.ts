import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "../activities/review.ts";
import type {
	DimensionFindings,
	ReviewDimension,
	Usage,
} from "../contracts/review.ts";

const { runAgentReview } = proxyActivities<typeof activities>({
	startToCloseTimeout: "300s",
	heartbeatTimeout: "30s",
	retry: { maximumAttempts: 3 },
});

export interface ReviewWorkerInput {
	dimension: ReviewDimension;
	workingDir: string;
	pr: {
		owner: string;
		repo: string;
		pr: number;
		headSha: string;
		baseSha: string;
	};
}

export async function reviewWorkerWorkflow(
	input: ReviewWorkerInput,
): Promise<{ findings: DimensionFindings; usage: Usage }> {
	return runAgentReview(input.dimension, input.workingDir, input.pr);
}
