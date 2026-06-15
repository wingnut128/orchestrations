import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "../activities/review.ts";
import type { Finding, Provider, Usage, Verdict } from "../contracts/review.ts";

const { verifyFinding } = proxyActivities<typeof activities>({
	startToCloseTimeout: "180s",
	heartbeatTimeout: "30s",
	retry: { maximumAttempts: 3 },
});

export interface VerifyFindingInput {
	finding: Finding;
	workingDir: string;
	provider: Provider;
	verifierCount: number;
}

export async function verifyFindingWorkflow(
	input: VerifyFindingInput,
): Promise<{ verdict: Verdict; usage: Usage }> {
	return verifyFinding(
		input.finding,
		input.workingDir,
		input.provider,
		input.verifierCount,
	);
}
