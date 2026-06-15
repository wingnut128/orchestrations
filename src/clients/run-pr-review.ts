import { Client } from "@temporalio/client";
import { ReviewRequest } from "../contracts/review.ts";
import { createConnection, namespace } from "../temporal-connection.ts";

function parseArgs(): ReviewRequest {
	const [slug, prStr] = process.argv.slice(2);
	if (!slug || !prStr || !slug.includes("/")) {
		console.error(
			"Usage: bun run client:pr-review <owner>/<repo> <pr> [--human-gate] [--critic] [--min=low|medium|high|critical]",
		);
		process.exit(1);
	}
	const [owner, repo] = slug.split("/");
	const flags = process.argv.slice(4);
	const min = flags.find((f) => f.startsWith("--min="))?.split("=")[1];
	return ReviewRequest.parse({
		owner,
		repo,
		pr: Number.parseInt(prStr, 10),
		humanGate: flags.includes("--human-gate"),
		completenessCritic: flags.includes("--critic"),
		...(min ? { minSeverity: min } : {}),
	});
}

async function run() {
	const req = parseArgs();
	const connection = await createConnection();
	const client = new Client({ connection, namespace });
	const workflowId = `review-${req.owner}-${req.repo}-${req.pr}`;
	console.log(`Starting review ${workflowId} ...`);
	const handle = await client.workflow.start("reviewOrchestratorWorkflow", {
		args: [req],
		taskQueue: "review",
		workflowId,
	});
	console.log(`Workflow started: ${handle.workflowId}. Waiting for result...`);
	const report = await handle.result();
	console.log(`\n=== Review summary ===\n${report.summary}`);
	console.log(
		`Confirmed: ${report.confirmed.length}, Dropped: ${report.dropped.length}`,
	);
	await connection.close();
}

run().catch((err) => {
	console.error(err);
	process.exit(1);
});
