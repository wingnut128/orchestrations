export interface BuildResult {
	success: boolean;
	artifactUrl: string;
	durationMs: number;
}

export interface TestResult {
	success: boolean;
	passed: number;
	failed: number;
	skipped: number;
}

export interface CodeReviewResult {
	reviewId: string;
	status: "pending";
}

export interface SecurityScanResult {
	scanId: string;
	status: "pending";
}

export interface DeployResult {
	success: boolean;
	environment: string;
	deploymentUrl: string;
}

export async function build(commitSha: string): Promise<BuildResult> {
	console.log(`[activity] build started for commit ${commitSha}`);
	// Stub: simulate build duration
	return {
		success: true,
		artifactUrl: `https://artifacts.example.com/${commitSha}.tar.gz`,
		durationMs: 42_000,
	};
}

export async function test(artifactUrl: string): Promise<TestResult> {
	console.log(`[activity] test started for artifact ${artifactUrl}`);
	return {
		success: true,
		passed: 127,
		failed: 0,
		skipped: 3,
	};
}

export async function requestCodeReview(
	commitSha: string,
	pipelineWorkflowId: string,
	owner: string,
	repo: string,
): Promise<CodeReviewResult> {
	console.log(
		`[activity] code review requested for ${owner}/${repo}@${commitSha.slice(0, 7)} (pipeline: ${pipelineWorkflowId})`,
	);

	const { Client } = await import("@temporalio/client");
	const { createConnection, namespace } = await import(
		"../temporal-connection.ts"
	);
	const connection = await createConnection();
	const client = new Client({ connection, namespace });

	const reviewWorkflowId = `code-review-${commitSha.slice(0, 12)}-${Date.now()}`;

	await client.workflow.start("codeReviewWorkflow", {
		taskQueue: "code-review",
		workflowId: reviewWorkflowId,
		args: [{ commitSha, pipelineWorkflowId, owner, repo }],
	});

	console.log(`[activity] started code-review workflow: ${reviewWorkflowId}`);
	return {
		reviewId: reviewWorkflowId,
		status: "pending",
	};
}

export async function requestSecurityScan(
	commitSha: string,
	pipelineWorkflowId: string,
	owner: string,
	repo: string,
): Promise<SecurityScanResult> {
	console.log(
		`[activity] security scan requested for ${owner}/${repo}@${commitSha.slice(0, 7)} (pipeline: ${pipelineWorkflowId})`,
	);

	const { Client } = await import("@temporalio/client");
	const { createConnection, namespace } = await import(
		"../temporal-connection.ts"
	);
	const connection = await createConnection();
	const client = new Client({ connection, namespace });

	const scanWorkflowId = `security-scan-${commitSha.slice(0, 12)}-${Date.now()}`;

	await client.workflow.start("securityScanWorkflow", {
		taskQueue: "security-scan",
		workflowId: scanWorkflowId,
		args: [{ commitSha, pipelineWorkflowId, owner, repo }],
	});

	console.log(`[activity] started security-scan workflow: ${scanWorkflowId}`);
	return {
		scanId: scanWorkflowId,
		status: "pending",
	};
}

export async function deploy(
	artifactUrl: string,
	environment: string,
): Promise<DeployResult> {
	console.log(
		`[activity] deploy started to ${environment} from ${artifactUrl}`,
	);
	return {
		success: true,
		environment,
		deploymentUrl: `https://${environment}.example.com`,
	};
}
