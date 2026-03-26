import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "../activities/greeter.ts";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

async function run() {
  const connection = await NativeConnection.connect({
    address: process.env["TEMPORAL_ADDRESS"] ?? "localhost:7233",
  });

  // Resolve workflow path relative to this file.
  // Use .js extension for bundled builds (Docker/Node) and .ts for local Bun dev.
  const dir = typeof __dirname !== "undefined"
    ? __dirname
    : dirname(fileURLToPath(import.meta.url));
  const ext = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
  const workflowsPath = resolve(dir, `../workflows/greeter${ext}`);

  const worker = await Worker.create({
    connection,
    namespace: "default",
    taskQueue: "greeter",
    workflowsPath,
    activities,
  });

  console.log("Worker started on task queue: greeter");
  await worker.run();
}

run().catch((err) => {
  console.error("Worker failed:", err);
  process.exit(1);
});
