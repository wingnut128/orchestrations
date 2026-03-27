import { Client, Connection } from "@temporalio/client";

async function run() {
	const connection = await Connection.connect({ address: "localhost:7233" });
	const client = new Client({ connection });

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
