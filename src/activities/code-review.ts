import Anthropic from "@anthropic-ai/sdk";
import { Client, Connection } from "@temporalio/client";
import { codeReviewCompleteSignal } from "../workflows/ci-pipeline.ts";

const anthropic = new Anthropic();

export async function fetchDiff(commitSha: string): Promise<string> {
	console.log(`[activity] fetchDiff for commit ${commitSha}`);
	// Stub: return a sample diff — will wire to real git later
	return `diff --git a/src/utils/auth.ts b/src/utils/auth.ts
index 3a1b2c3..4d5e6f7 100644
--- a/src/utils/auth.ts
+++ b/src/utils/auth.ts
@@ -12,8 +12,12 @@ export function validateToken(token: string): boolean {
-  if (!token) return false;
-  return token.length > 0;
+  if (!token || typeof token !== "string") return false;
+  if (token.length < 32) return false;
+  try {
+    const decoded = Buffer.from(token, "base64");
+    return decoded.length > 0 && decoded.toString("base64") === token;
+  } catch {
+    return false;
+  }
 }

diff --git a/src/handlers/login.ts b/src/handlers/login.ts
index 7f8g9h0..1a2b3c4 100644
--- a/src/handlers/login.ts
+++ b/src/handlers/login.ts
@@ -5,3 +5,9 @@ export async function handleLogin(req: Request): Promise<Response> {
+  const rateLimit = getRateLimiter(req.ip);
+  if (rateLimit.isExceeded()) {
+    return new Response("Too many requests", { status: 429 });
+  }
+
   const { username, password } = await req.json();`;
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
