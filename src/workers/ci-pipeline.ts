import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "../activities/ci-pipeline.ts";

async function run() {
	const connection = await NativeConnection.connect({
		address: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
	});

	const dir =
		typeof __dirname !== "undefined"
			? __dirname
			: dirname(fileURLToPath(import.meta.url));
	const ext = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
	const workflowsPath = resolve(dir, `../workflows/ci-pipeline${ext}`);

	const worker = await Worker.create({
		connection,
		namespace: "default",
		taskQueue: "ci-pipeline",
		workflowsPath,
		activities,
	});

	console.log("Worker started on task queue: ci-pipeline");
	await worker.run();
}

run().catch((err) => {
	console.error("Worker failed:", err);
	process.exit(1);
});
