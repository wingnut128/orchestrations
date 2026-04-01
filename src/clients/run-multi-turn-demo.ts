import { Client } from "@temporalio/client";
import {
	addUserMessageSignal,
	getConversationHistoryQuery,
} from "../signals/agent-protocol.ts";
import { createConnection, namespace } from "../temporal-connection.ts";
import type { AgentTaskInput, AgentTaskResult } from "../types/conversation.ts";

async function run() {
	const connection = await createConnection();
	const client = new Client({ connection, namespace });

	const workflowId = `multi-turn-${Date.now()}`;

	const input: AgentTaskInput = {
		task: "You are helping me design a Temporal workflow. What are the key things I should know about workflow determinism?",
		systemPrompt:
			"You are a Temporal workflow expert. Keep responses concise (2-3 paragraphs max). Reference specific Temporal concepts.",
		maxTurns: 5,
		idleTimeoutSeconds: 120,
	};

	console.log(`Starting multi-turn agent conversation: ${workflowId}\n`);

	const handle = await client.workflow.start("agentTaskWorkflow", {
		taskQueue: "agent-task",
		workflowId,
		args: [input],
	});

	// Wait for the first response
	await waitForHistory(handle, 2);
	let history = await handle.query(getConversationHistoryQuery);
	console.log(`[Turn 1] User: ${history[0].content}\n`);
	console.log(`[Turn 1] Agent: ${history[1].content}\n`);
	console.log("---\n");

	// Send a follow-up question
	const followUp =
		"How should I handle side effects like API calls? Can I call them directly in a workflow?";
	console.log(`[Turn 2] User: ${followUp}\n`);
	await handle.signal(addUserMessageSignal, followUp);

	// Wait for the response
	await waitForHistory(handle, 4);
	history = await handle.query(getConversationHistoryQuery);
	console.log(`[Turn 2] Agent: ${history[3].content}\n`);
	console.log("---\n");

	// One more follow-up
	const followUp2 = "What about signals and queries? When should I use each?";
	console.log(`[Turn 3] User: ${followUp2}\n`);
	await handle.signal(addUserMessageSignal, followUp2);

	await waitForHistory(handle, 6);
	history = await handle.query(getConversationHistoryQuery);
	console.log(`[Turn 3] Agent: ${history[5].content}\n`);
	console.log("---\n");

	// Let the workflow complete via idle timeout or get result
	console.log(
		"Conversation complete. Waiting for workflow to finish (idle timeout)...",
	);
	const result = (await handle.result()) as AgentTaskResult;
	console.log(
		`\nFinal: ${result.turns} turns, ${result.history.length} messages`,
	);
}

async function waitForHistory(
	handle: Awaited<ReturnType<Client["workflow"]["start"]>>,
	minMessages: number,
): Promise<void> {
	const maxAttempts = 60;
	for (let i = 0; i < maxAttempts; i++) {
		const history = await handle.query(getConversationHistoryQuery);
		if (history.length >= minMessages) return;
		await new Promise((resolve) => setTimeout(resolve, 1_000));
	}
	throw new Error(`Timed out waiting for ${minMessages} messages in history`);
}

run().catch((err) => {
	console.error("Client failed:", err);
	process.exit(1);
});
