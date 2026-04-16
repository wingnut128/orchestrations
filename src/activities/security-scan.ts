import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApplicationFailure } from "@temporalio/common";
import { config } from "../config.ts";
import { agentResultSignal } from "../signals/agent-protocol.ts";
import { traceActivity } from "../telemetry/instrumentation.ts";
import { getSharedClient } from "../temporal-connection.ts";

export interface ScanFindings {
	critical: number;
	high: number;
	medium: number;
	low: number;
	summary: string;
}

interface SnykVulnerability {
	id: string;
	severity: string;
	title: string;
	packageName: string;
	version: string;
}

interface SnykOutput {
	ok: boolean;
	vulnerabilities: SnykVulnerability[];
	summary?: string;
}

// --- Helpers ---

export function runCommand(
	cmd: string,
	args: string[],
	opts?: { cwd?: string; timeoutMs?: number },
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const timeoutMs = opts?.timeoutMs ?? 60_000;
	return new Promise((resolve, reject) => {
		const proc = execFile(
			cmd,
			args,
			{ cwd: opts?.cwd, maxBuffer: 10 * 1024 * 1024, timeout: timeoutMs },
			(error, stdout, stderr) => {
				if (error && !("code" in error)) {
					reject(error);
					return;
				}
				resolve({
					exitCode: proc.exitCode ?? (error ? 1 : 0),
					stdout: stdout ?? "",
					stderr: stderr ?? "",
				});
			},
		);
	});
}

async function cloneRepo(
	owner: string,
	repo: string,
	commitSha: string,
): Promise<string> {
	const token = config.forgejo.token;
	if (!token) {
		throw ApplicationFailure.nonRetryable(
			"FORGEJO_TOKEN is required for cloning repositories",
		);
	}

	const baseUrl = new URL(config.forgejo.url);
	const cloneUrl = `${baseUrl.protocol}//${token}@${baseUrl.host}/${owner}/${repo}.git`;
	const sanitizedUrl = cloneUrl.replace(token, "***");

	const tempDir = await mkdtemp(join(tmpdir(), "snyk-scan-"));
	const repoDir = join(tempDir, "repo");

	console.log(`[activity] cloning ${sanitizedUrl} → ${repoDir}`);

	const cloneResult = await runCommand("git", [
		"clone",
		"--no-checkout",
		cloneUrl,
		repoDir,
	]);
	if (cloneResult.exitCode !== 0) {
		const sanitizedStderr = cloneResult.stderr.replaceAll(token, "***");
		throw new Error(
			`git clone failed (exit ${cloneResult.exitCode}): ${sanitizedStderr}`,
		);
	}

	await checkoutCommit(repoDir, commitSha);

	console.log(`[activity] cloned ${owner}/${repo}@${commitSha.slice(0, 7)}`);
	return tempDir;
}

export async function checkoutCommit(
	repoDir: string,
	commitSha: string,
): Promise<void> {
	const result = await runCommand("git", [
		"-C",
		repoDir,
		"-c",
		"advice.detachedHead=false",
		"checkout",
		commitSha,
	]);
	if (result.exitCode !== 0) {
		throw new Error(
			`git checkout ${commitSha} failed (exit ${result.exitCode}): ${result.stderr}`,
		);
	}
}

async function runSnykTest(repoDir: string): Promise<ScanFindings> {
	const snykToken = process.env.SNYK_TOKEN;
	if (!snykToken) {
		throw ApplicationFailure.nonRetryable(
			"SNYK_TOKEN is required for security scanning",
		);
	}

	const { exitCode, stdout, stderr } = await runCommand(
		"snyk",
		["test", "--json"],
		{ cwd: repoDir, timeoutMs: 90_000 },
	);

	if (exitCode >= 2) {
		throw new Error(`snyk test failed (exit ${exitCode}): ${stderr}`);
	}

	return parseSnykOutput(stdout);
}

export function parseSnykOutput(stdout: string): ScanFindings {
	const parsed = JSON.parse(stdout) as SnykOutput;
	const counts = { critical: 0, high: 0, medium: 0, low: 0 };

	for (const vuln of parsed.vulnerabilities) {
		const sev = vuln.severity as keyof typeof counts;
		if (sev in counts) {
			counts[sev]++;
		}
	}

	const total = counts.critical + counts.high + counts.medium + counts.low;
	const summary =
		total === 0
			? "No vulnerabilities found"
			: `Found ${total} vulnerabilities: ${counts.critical} critical, ${counts.high} high, ${counts.medium} medium, ${counts.low} low`;

	return { ...counts, summary };
}

// --- Activities ---

export async function scanForVulnerabilities(
	commitSha: string,
	owner: string,
	repo: string,
): Promise<ScanFindings> {
	return traceActivity("snyk.scanForVulnerabilities", async (span) => {
		span.setAttribute("git.commit_sha", commitSha);
		span.setAttribute("git.repository", `${owner}/${repo}`);

		console.log(
			`[activity] security scan started for ${owner}/${repo}@${commitSha.slice(0, 7)}`,
		);

		let tempDir: string | undefined;
		try {
			tempDir = await cloneRepo(owner, repo, commitSha);
			const repoDir = join(tempDir, "repo");
			const findings = await runSnykTest(repoDir);

			span.setAttribute("scan.critical", findings.critical);
			span.setAttribute("scan.high", findings.high);
			span.setAttribute("scan.medium", findings.medium);
			span.setAttribute("scan.low", findings.low);

			console.log(`[activity] security scan complete: ${findings.summary}`);
			return findings;
		} finally {
			if (tempDir) {
				await rm(tempDir, { recursive: true, force: true }).catch((err) =>
					console.warn(`[activity] failed to clean up ${tempDir}: ${err}`),
				);
			}
		}
	});
}

export async function signalPipelineScanResult(
	pipelineWorkflowId: string,
	approved: boolean,
	details: string,
): Promise<void> {
	return traceActivity("temporal.signalPipelineScanResult", async (span) => {
		span.setAttribute("workflow.id", pipelineWorkflowId);
		span.setAttribute("scan.approved", approved);

		console.log(
			`[activity] signalPipelineScanResult → workflow ${pipelineWorkflowId}, approved=${approved}`,
		);

		const client = await getSharedClient();
		const handle = client.workflow.getHandle(pipelineWorkflowId);
		await handle.signal(agentResultSignal, {
			agentType: "security-scan",
			approved,
			agent: "security-scan-agent",
			details,
		});

		console.log("[activity] signalPipelineScanResult sent successfully");
	});
}
