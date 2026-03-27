import Anthropic from "@anthropic-ai/sdk";
import { Client, Connection } from "@temporalio/client";
import { config } from "../config.ts";
import { codeReviewCompleteSignal } from "../workflows/ci-pipeline.ts";

const anthropic = new Anthropic();

/**
 * Fetch a commit diff from the Forgejo API.
 *
 * Endpoint: GET /api/v1/repos/{owner}/{repo}/git/commits/{sha}.diff
 * Falls back to a patch endpoint if .diff is unavailable.
 */
export async function fetchDiff(
	commitSha: string,
	owner?: string,
	repo?: string,
): Promise<string> {
	const repoOwner = owner ?? process.env.FORGEJO_REPO_OWNER ?? "";
	const repoName = repo ?? process.env.FORGEJO_REPO_NAME ?? "";

	if (!repoOwner || !repoName) {
		throw new Error(
			"fetchDiff requires owner/repo — set FORGEJO_REPO_OWNER and FORGEJO_REPO_NAME or pass them as arguments",
		);
	}

	const url = `${config.forgejo.url}/api/v1/repos/${encodeURIComponent(repoOwner)}/${encodeURIComponent(repoName)}/git/commits/${encodeURIComponent(commitSha)}.diff`;

	console.log(`[activity] fetchDiff GET ${url}`);

	const headers: Record<string, string> = {
		Accept: "text/plain",
	};
	if (config.forgejo.token) {
		headers.Authorization = `token ${config.forgejo.token}`;
	}

	const response = await fetch(url, { headers });

	if (!response.ok) {
		throw new Error(
			`Forgejo API error: ${response.status} ${response.statusText} — ${url}`,
		);
	}

	const diff = await response.text();
	console.log(`[activity] fetchDiff got ${diff.length} chars for ${commitSha}`);
	return diff;
}

export async function reviewDiff(
	diff: string,
): Promise<{ approved: boolean; feedback: string }> {
	console.log(`[activity] reviewDiff called with diff of ${diff.length} chars`);

	const systemPrompt = `You are a senior code reviewer. Analyze the provided git diff carefully.

Evaluate the changes for:
- Correctness and potential bugs
- Security issues
- Code style and readability
- Performance concerns

Return ONLY a valid JSON object with exactly two fields:
- "approved": boolean — true if the changes are acceptable, false if they need revision
- "feedback": string — a concise summary of your review findings

Do not include any text outside the JSON object. Do not wrap it in markdown code fences.`;

	const response = await anthropic.messages.create({
		model: "claude-sonnet-4-6",
		max_tokens: 1024,
		system: systemPrompt,
		messages: [
			{
				role: "user",
				content: `Please review the following diff:\n\n${diff}`,
			},
		],
	});

	const text = response.content
		.filter((block): block is Anthropic.TextBlock => block.type === "text")
		.map((block) => block.text)
		.join("\n");

	console.log(`[activity] Claude review response: ${text}`);

	const parsed = JSON.parse(text) as { approved: boolean; feedback: string };
	return {
		approved: parsed.approved,
		feedback: parsed.feedback,
	};
}

export async function signalPipelineReview(
	pipelineWorkflowId: string,
	approved: boolean,
	feedback: string,
): Promise<void> {
	console.log(
		`[activity] signalPipelineReview → workflow ${pipelineWorkflowId}, approved=${approved}`,
	);

	const connection = await Connection.connect({
		address: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
	});
	const client = new Client({ connection });

	const handle = client.workflow.getHandle(pipelineWorkflowId);
	await handle.signal(codeReviewCompleteSignal, {
		approved,
		reviewer: `claude-review-agent: ${feedback}`,
	});

	console.log("[activity] signalPipelineReview sent successfully");
}
