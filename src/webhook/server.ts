import { config } from "../config.ts";
import { traceActivity } from "../telemetry/instrumentation.ts";
import { initTracing } from "../telemetry/tracing.ts";
import { getSharedClient } from "../temporal-connection.ts";
import { verifySignature } from "./verify.ts";

initTracing();

interface ForgejoPushPayload {
	ref: string;
	after: string;
	before: string;
	commits: Array<{
		id: string;
		message: string;
		url: string;
	}>;
	repository: {
		full_name: string;
		name: string;
		owner: {
			login: string;
		};
	};
	sender: {
		login: string;
	};
}

const SHA_RE = /^[0-9a-f]{7,40}$/i;
const NAME_RE = /^[a-zA-Z0-9._-]+$/;

class BadRequestError extends Error {}

function isPushPayload(value: unknown): value is ForgejoPushPayload {
	if (!value || typeof value !== "object") return false;
	const v = value as Record<string, unknown>;
	if (typeof v.after !== "string" || typeof v.ref !== "string") return false;
	const repo = v.repository as Record<string, unknown> | undefined;
	if (!repo || typeof repo.name !== "string") return false;
	const owner = repo.owner as Record<string, unknown> | undefined;
	if (!owner || typeof owner.login !== "string") return false;
	return true;
}

async function handlePush(payload: ForgejoPushPayload): Promise<string> {
	return traceActivity("webhook.handlePush", async (span) => {
		const headCommit = payload.after;
		const owner = payload.repository.owner.login;
		const repo = payload.repository.name;
		const branch = payload.ref.replace("refs/heads/", "");

		if (!SHA_RE.test(headCommit)) {
			throw new BadRequestError(
				`Invalid commit SHA: ${headCommit.slice(0, 20)}`,
			);
		}
		if (!NAME_RE.test(owner) || !NAME_RE.test(repo)) {
			throw new BadRequestError(`Invalid owner/repo: ${owner}/${repo}`);
		}

		span.setAttribute("git.commit_sha", headCommit);
		span.setAttribute("git.repository", `${owner}/${repo}`);
		span.setAttribute("git.branch", branch);

		console.log(
			`[webhook] push to ${owner}/${repo}#${branch} — head commit ${headCommit}`,
		);

		const client = await getSharedClient();
		const workflowId = `ci-pipeline-${headCommit.slice(0, 12)}-${Date.now()}`;

		await client.workflow.start("ciPipelineWorkflow", {
			taskQueue: "ci-pipeline",
			workflowId,
			args: [{ commitSha: headCommit, owner, repo }],
		});

		span.setAttribute("workflow.id", workflowId);
		console.log(`[webhook] started workflow ${workflowId}`);
		return workflowId;
	});
}

if (!config.webhook.secret) {
	throw new Error(
		"WEBHOOK_SECRET is required — refusing to start without signature verification",
	);
}

const server = Bun.serve({
	port: config.webhook.port,

	async fetch(req: Request): Promise<Response> {
		try {
			const url = new URL(req.url);

			// Health check
			if (url.pathname === "/health") {
				return Response.json({ status: "ok" });
			}

			// Forgejo webhook endpoint
			if (req.method === "POST" && url.pathname === "/webhook/forgejo") {
				const body = await req.text();

				// Verify HMAC signature
				const signature = req.headers.get("x-forgejo-signature") ?? "";
				if (!verifySignature(body, signature, config.webhook.secret)) {
					console.warn("[webhook] signature verification failed");
					return new Response("Forbidden", { status: 403 });
				}

				const event = req.headers.get("x-forgejo-event");
				console.log(`[webhook] received event: ${event}`);

				if (event === "push") {
					let parsed: unknown;
					try {
						parsed = JSON.parse(body);
					} catch {
						return new Response("Invalid JSON", { status: 400 });
					}
					if (!isPushPayload(parsed)) {
						return new Response("Invalid push payload", { status: 400 });
					}
					const workflowId = await handlePush(parsed);
					return Response.json({ ok: true, workflowId });
				}

				// Acknowledge other events without acting
				return Response.json({ ok: true, ignored: true });
			}

			return new Response("Not Found", { status: 404 });
		} catch (err) {
			if (err instanceof BadRequestError) {
				console.warn(`[webhook] bad request: ${err.message}`);
				return new Response(err.message, { status: 400 });
			}
			console.error("[webhook] unhandled error:", err);
			return new Response("Internal Server Error", { status: 500 });
		}
	},
});

console.log(
	`[webhook] listening on http://localhost:${server.port}/webhook/forgejo`,
);
