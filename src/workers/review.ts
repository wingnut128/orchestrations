import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "@temporalio/worker";
import * as ghActivities from "../activities/github.ts";
import * as reviewActivities from "../activities/review.ts";
import { initTracing, shutdownTracing } from "../telemetry/tracing.ts";
import { createNativeConnection, namespace } from "../temporal-connection.ts";

async function run() {
	initTracing();
	const connection = await createNativeConnection();
	const dir =
		typeof __dirname !== "undefined"
			? __dirname
			: dirname(fileURLToPath(import.meta.url));
	const ext = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
	const workflowsPath = resolve(dir, `../workflows/review-orchestrator${ext}`);

	const worker = await Worker.create({
		connection,
		namespace,
		taskQueue: "review",
		workflowsPath,
		activities: { ...ghActivities, ...reviewActivities },
	});
	console.log("Worker started on task queue: review");
	await worker.run();
}

run()
	.catch((err) => {
		console.error("Worker failed:", err);
		process.exit(1);
	})
	.finally(() => shutdownTracing());
