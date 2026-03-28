import { Client } from "@temporalio/client";
import { createConnection, namespace } from "../temporal-connection.ts";

async function run() {
	const connection = await createConnection();
	const client = new Client({ connection, namespace });

	const result = await client.workflow.execute("agentTaskWorkflow", {
		taskQueue: "agent-task",
		workflowId: `agent-task-${Date.now()}`,
		args: [
			"Explain the benefits of using Temporal for orchestrating LLM agent workflows in 3 bullet points.",
		],
	});

	console.log(`Workflow result:\n${result}`);
}

run().catch((err) => {
	console.error("Client failed:", err);
	process.exit(1);
});
