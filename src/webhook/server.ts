import { Client } from "@temporalio/client";
import { config } from "../config.ts";
import { createConnection, namespace } from "../temporal-connection.ts";
import { verifySignature } from "./verify.ts";

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

async function getTemporalClient(): Promise<Client> {
	const connection = await createConnection();
	return new Client({ connection, namespace });
}

async function handlePush(payload: ForgejoPushPayload): Promise<string> {
	const headCommit = payload.after;
	const owner = payload.repository.owner.login;
	const repo = payload.repository.name;
	const branch = payload.ref.replace("refs/heads/", "");

	console.log(
		`[webhook] push to ${owner}/${repo}#${branch} — head commit ${headCommit}`,
	);

	const client = await getTemporalClient();
	const workflowId = `ci-pipeline-${headCommit.slice(0, 12)}-${Date.now()}`;

	await client.workflow.start("ciPipelineWorkflow", {
		taskQueue: "ci-pipeline",
		workflowId,
		args: [{ commitSha: headCommit, owner, repo }],
	});

	console.log(`[webhook] started workflow ${workflowId}`);
	return workflowId;
}

const server = Bun.serve({
	port: config.webhook.port,

	async fetch(req: Request): Promise<Response> {
		const url = new URL(req.url);

		// Health check
		if (url.pathname === "/health") {
			return Response.json({ status: "ok" });
		}

		// Forgejo webhook endpoint
		if (req.method === "POST" && url.pathname === "/webhook/forgejo") {
			const body = await req.text();

			// Verify HMAC signature if a secret is configured
			if (config.webhook.secret) {
				const signature = req.headers.get("x-forgejo-signature") ?? "";
				if (!verifySignature(body, signature, config.webhook.secret)) {
					console.warn("[webhook] signature verification failed");
					return new Response("Forbidden", { status: 403 });
				}
			}

			const event = req.headers.get("x-forgejo-event");
			console.log(`[webhook] received event: ${event}`);

			if (event === "push") {
				const payload = JSON.parse(body) as ForgejoPushPayload;
				const workflowId = await handlePush(payload);
				return Response.json({ ok: true, workflowId });
			}

			// Acknowledge other events without acting
			return Response.json({ ok: true, ignored: true });
		}

		return new Response("Not Found", { status: 404 });
	},
});

console.log(
	`[webhook] listening on http://localhost:${server.port}/webhook/forgejo`,
);
