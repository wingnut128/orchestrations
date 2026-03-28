import { Client } from "@temporalio/client";
import { createConnection, namespace } from "../temporal-connection.ts";

async function run() {
	const connection = await createConnection();
	const client = new Client({ connection, namespace });

	const result = await client.workflow.execute("greeterWorkflow", {
		taskQueue: "greeter",
		workflowId: `greeter-${Date.now()}`,
		args: ["Temporal"],
	});

	console.log(`Workflow result: ${result}`);
}

run().catch((err) => {
	console.error("Client failed:", err);
	process.exit(1);
});
