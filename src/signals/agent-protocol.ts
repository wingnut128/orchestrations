import { defineSignal } from "@temporalio/workflow";

// --- Agent Result Signal (agent → pipeline) ---

export interface AgentResult {
	agentType: string;
	approved: boolean;
	agent: string;
	details?: string;
}

/** Generic signal for any agent to report results back to a parent workflow. */
export const agentResultSignal = defineSignal<[AgentResult]>("agentResult");

// --- Deploy Approval Signal (human → pipeline) ---

export interface DeployApprovalPayload {
	approved: boolean;
	approver: string;
}

export const deployApprovalSignal =
	defineSignal<[DeployApprovalPayload]>("deployApproval");

// --- Agent Task Request (workflow input for agent workflows) ---

export interface AgentTaskRequest {
	commitSha: string;
	pipelineWorkflowId: string;
	owner: string;
	repo: string;
}
