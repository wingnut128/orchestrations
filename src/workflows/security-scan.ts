import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "../activities/security-scan.ts";
import type { AgentTaskRequest } from "../signals/agent-protocol.ts";

const { scanForVulnerabilities, signalPipelineScanResult } = proxyActivities<
	typeof activities
>({
	startToCloseTimeout: "120s",
});

export interface SecurityScanResult {
	commitSha: string;
	approved: boolean;
	findings: string;
}

export async function securityScanWorkflow(
	input: AgentTaskRequest,
): Promise<SecurityScanResult> {
	const { commitSha, pipelineWorkflowId, owner, repo } = input;

	// Step 1: Run the security scan
	const findings = await scanForVulnerabilities(commitSha, owner, repo);

	// Step 2: Determine approval (no critical or high findings)
	const approved = findings.critical === 0 && findings.high === 0;

	// Step 3: Signal the CI pipeline with the result
	await signalPipelineScanResult(
		pipelineWorkflowId,
		approved,
		findings.summary,
	);

	return {
		commitSha,
		approved,
		findings: findings.summary,
	};
}
