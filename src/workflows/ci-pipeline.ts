import {
	condition,
	defineQuery,
	proxyActivities,
	setHandler,
	workflowInfo,
} from "@temporalio/workflow";
import type * as activities from "../activities/ci-pipeline.ts";
import {
	type AgentResult,
	agentResultSignal,
	deployApprovalSignal,
} from "../signals/agent-protocol.ts";

// --- Queries ---

export const getPipelineStateQuery =
	defineQuery<PipelineState>("getPipelineState");

// --- Types ---

export type PipelineStage =
	| "queued"
	| "building"
	| "testing"
	| "awaiting-agent-results"
	| "awaiting-deploy-approval"
	| "deploying"
	| "completed"
	| "failed";

export interface PipelineState {
	stage: PipelineStage;
	commitSha: string;
	buildResult?: activities.BuildResult;
	testResult?: activities.TestResult;
	agentResults: Record<string, AgentResult>;
	deployApproval?: {
		approved: boolean;
		approver: string;
	};
	deployResult?: activities.DeployResult;
	error?: string;
}

// --- Activity proxies ---

const { build, test, requestCodeReview, requestSecurityScan, deploy } =
	proxyActivities<typeof activities>({
		startToCloseTimeout: "60s",
	});

// --- Types (input) ---

export interface PipelineInput {
	commitSha: string;
	owner: string;
	repo: string;
}

// --- Workflow ---

const EXPECTED_AGENTS = ["code-review", "security-scan"];

export async function ciPipelineWorkflow(
	input: PipelineInput,
): Promise<PipelineState> {
	const { commitSha, owner, repo } = input;
	const state: PipelineState = {
		stage: "queued",
		commitSha,
		agentResults: {},
	};

	// Mutable flag set by signal handler
	let deployApprovalReceived = false;

	// Register signal handlers
	setHandler(agentResultSignal, (result: AgentResult) => {
		state.agentResults[result.agentType] = result;
	});

	setHandler(deployApprovalSignal, ({ approved, approver }) => {
		state.deployApproval = { approved, approver };
		deployApprovalReceived = true;
	});

	// Register query handler
	setHandler(getPipelineStateQuery, () => state);

	// --- Stage 1: Build ---
	state.stage = "building";
	const buildResult = await build(commitSha);
	state.buildResult = buildResult;

	if (!buildResult.success) {
		state.stage = "failed";
		state.error = "Build failed";
		return state;
	}

	// --- Stage 2: Test ---
	state.stage = "testing";
	const testResult = await test(buildResult.artifactUrl);
	state.testResult = testResult;

	if (!testResult.success) {
		state.stage = "failed";
		state.error = `Tests failed: ${testResult.failed} failures`;
		return state;
	}

	// --- Stage 3: Fan-out to agents ---
	state.stage = "awaiting-agent-results";
	const pipelineWorkflowId = workflowInfo().workflowId;

	await Promise.all([
		requestCodeReview(commitSha, pipelineWorkflowId, owner, repo),
		requestSecurityScan(commitSha, pipelineWorkflowId, owner, repo),
	]);

	// Fan-in: wait until all expected agents have reported back
	const allAgentsReported = await condition(
		() => EXPECTED_AGENTS.every((t) => t in state.agentResults),
		"24h",
	);

	if (!allAgentsReported) {
		state.stage = "failed";
		state.error = "Agent results timed out after 24 hours";
		return state;
	}

	// Check if all agents approved
	const rejections = EXPECTED_AGENTS.filter(
		(t) => !state.agentResults[t].approved,
	);
	if (rejections.length > 0) {
		state.stage = "failed";
		state.error = `Rejected by agents: ${rejections.join(", ")}`;
		return state;
	}

	// --- Stage 4: Deploy Approval ---
	state.stage = "awaiting-deploy-approval";

	// Wait for the deploy approval signal (up to 1 hour)
	const approvalReceived = await condition(() => deployApprovalReceived, "1h");
	if (!approvalReceived) {
		state.stage = "failed";
		state.error = "Deploy approval timed out after 1 hour";
		return state;
	}

	if (!state.deployApproval?.approved) {
		state.stage = "failed";
		state.error = `Deploy rejected by ${state.deployApproval?.approver}`;
		return state;
	}

	// --- Stage 5: Deploy ---
	state.stage = "deploying";
	const deployResult = await deploy(buildResult.artifactUrl, "production");
	state.deployResult = deployResult;

	if (!deployResult.success) {
		state.stage = "failed";
		state.error = "Deployment failed";
		return state;
	}

	state.stage = "completed";
	return state;
}
