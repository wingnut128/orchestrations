import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "@temporalio/worker";
import * as activities from "../activities/security-scan.ts";
import { createNativeConnection, namespace } from "../temporal-connection.ts";

async function run() {
	const connection = await createNativeConnection();

	const dir =
		typeof __dirname !== "undefined"
			? __dirname
			: dirname(fileURLToPath(import.meta.url));
	const ext = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
	const workflowsPath = resolve(dir, `../workflows/security-scan${ext}`);

	const worker = await Worker.create({
		connection,
		namespace,
		taskQueue: "security-scan",
		workflowsPath,
		activities,
	});

	console.log("Worker started on task queue: security-scan");
	await worker.run();
}

run().catch((err) => {
	console.error("Worker failed:", err);
	process.exit(1);
});
