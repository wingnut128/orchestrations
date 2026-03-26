import { Client, Connection } from "@temporalio/client";

async function run() {
  const connection = await Connection.connect({ address: "localhost:7233" });
  const client = new Client({ connection });

  const result = await client.workflow.execute("agentTaskWorkflow", {
    taskQueue: "agent-task",
    workflowId: `agent-task-${Date.now()}`,
    args: ["Explain the benefits of using Temporal for orchestrating LLM agent workflows in 3 bullet points."],
  });

  console.log(`Workflow result:\n${result}`);
}

run().catch((err) => {
  console.error("Client failed:", err);
  process.exit(1);
});
