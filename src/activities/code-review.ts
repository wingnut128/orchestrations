import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.ts";
import { agentResultSignal } from "../signals/agent-protocol.ts";
import {
	traceActivity,
	traceClaudeCall,
} from "../telemetry/instrumentation.ts";
import { getSharedClient } from "../temporal-connection.ts";

const anthropic = new Anthropic();
const MODEL = "claude-sonnet-4-6";

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
	return traceActivity("forgejo.fetchDiff", async (span) => {
		const repoOwner = owner ?? process.env.FORGEJO_REPO_OWNER ?? "";
		const repoName = repo ?? process.env.FORGEJO_REPO_NAME ?? "";

		if (!repoOwner || !repoName) {
			throw new Error(
				"fetchDiff requires owner/repo — set FORGEJO_REPO_OWNER and FORGEJO_REPO_NAME or pass them as arguments",
			);
		}

		span.setAttribute("git.commit_sha", commitSha);
		span.setAttribute("git.repository", `${repoOwner}/${repoName}`);

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
		span.setAttribute("diff.length", diff.length);
		console.log(
			`[activity] fetchDiff got ${diff.length} chars for ${commitSha}`,
		);
		return diff;
	});
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

	return traceClaudeCall(
		"claude.reviewDiff",
		{ model: MODEL, messageCount: 1 },
		async (span) => {
			const response = await anthropic.messages.create({
				model: MODEL,
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

			span.setAttribute("ai.usage.input_tokens", response.usage.input_tokens);
			span.setAttribute("ai.usage.output_tokens", response.usage.output_tokens);

			console.log(`[activity] Claude review response: ${text}`);

			const parsed = JSON.parse(text) as {
				approved: boolean;
				feedback: string;
			};
			span.setAttribute("review.approved", parsed.approved);
			return {
				approved: parsed.approved,
				feedback: parsed.feedback,
			};
		},
	);
}

export async function signalPipelineReview(
	pipelineWorkflowId: string,
	approved: boolean,
	feedback: string,
): Promise<void> {
	return traceActivity("temporal.signalPipelineReview", async (span) => {
		span.setAttribute("workflow.id", pipelineWorkflowId);
		span.setAttribute("review.approved", approved);

		console.log(
			`[activity] signalPipelineReview → workflow ${pipelineWorkflowId}, approved=${approved}`,
		);

		const client = await getSharedClient();
		const handle = client.workflow.getHandle(pipelineWorkflowId);
		await handle.signal(agentResultSignal, {
			agentType: "code-review",
			approved,
			agent: "claude-review-agent",
			details: feedback,
		});

		console.log("[activity] signalPipelineReview sent successfully");
	});
}
