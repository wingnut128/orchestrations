import { Client } from "@temporalio/client";
import { agentResultSignal } from "../signals/agent-protocol.ts";
import { createConnection, namespace } from "../temporal-connection.ts";

export interface ScanFindings {
	critical: number;
	high: number;
	medium: number;
	low: number;
	summary: string;
}

export async function scanForVulnerabilities(
	commitSha: string,
	_owner: string,
	_repo: string,
): Promise<ScanFindings> {
	console.log(
		`[activity] security scan started for ${_owner}/${_repo}@${commitSha.slice(0, 7)}`,
	);

	// Stub: simulate a security scan
	return {
		critical: 0,
		high: 0,
		medium: 2,
		low: 5,
		summary: "No critical or high severity findings. 2 medium, 5 low.",
	};
}

export async function signalPipelineScanResult(
	pipelineWorkflowId: string,
	approved: boolean,
	details: string,
): Promise<void> {
	console.log(
		`[activity] signalPipelineScanResult → workflow ${pipelineWorkflowId}, approved=${approved}`,
	);

	const connection = await createConnection();
	const client = new Client({ connection, namespace });

	const handle = client.workflow.getHandle(pipelineWorkflowId);
	await handle.signal(agentResultSignal, {
		agentType: "security-scan",
		approved,
		agent: "security-scan-agent",
		details,
	});

	console.log("[activity] signalPipelineScanResult sent successfully");
}
