import { condition, proxyActivities, setHandler } from "@temporalio/workflow";
import type * as activities from "../activities/claude-agent.ts";
import {
	addUserMessageSignal,
	getConversationHistoryQuery,
} from "../signals/agent-protocol.ts";
import type {
	AgentTaskInput,
	AgentTaskResult,
	ConversationMessage,
} from "../types/conversation.ts";

const { claudeAgent, claudeAgentConverse } = proxyActivities<typeof activities>(
	{
		startToCloseTimeout: "120s",
	},
);

/**
 * Multi-turn agent task workflow.
 *
 * Accepts either a simple string (backward-compatible single-shot) or a
 * full AgentTaskInput for multi-turn conversations. When running multi-turn,
 * the workflow waits for follow-up messages via the `addUserMessage` signal
 * and responds to each until maxTurns is reached or the idle timeout fires.
 */
export async function agentTaskWorkflow(
	input: string | AgentTaskInput,
): Promise<string | AgentTaskResult> {
	// Backward-compatible: string input → single-shot, string output
	if (typeof input === "string") {
		return await claudeAgent(input);
	}

	const {
		task,
		systemPrompt,
		history: resumedHistory,
		maxTurns = 10,
		idleTimeoutSeconds = 300,
	} = input;

	const conversationHistory: ConversationMessage[] = resumedHistory
		? [...resumedHistory]
		: [];

	// Queue for incoming user messages (via signal)
	const pendingMessages: string[] = [];

	// Wire up signal and query handlers
	setHandler(addUserMessageSignal, (message: string) => {
		pendingMessages.push(message);
	});

	setHandler(getConversationHistoryQuery, () => conversationHistory);

	// Turn 1: process the initial task
	conversationHistory.push({ role: "user", content: task });

	let lastResponse = "";
	let turns = 0;

	const result = await claudeAgentConverse({
		messages: conversationHistory,
		systemPrompt,
	});
	lastResponse = result.response;
	conversationHistory.push({ role: "assistant", content: lastResponse });
	turns++;

	// Subsequent turns: wait for follow-up signals
	while (turns < maxTurns) {
		const gotMessage = await condition(
			() => pendingMessages.length > 0,
			`${idleTimeoutSeconds}s`,
		);

		if (!gotMessage) {
			// Idle timeout — end the conversation
			break;
		}

		const userMessage = pendingMessages.shift() as string;
		conversationHistory.push({ role: "user", content: userMessage });

		const turnResult = await claudeAgentConverse({
			messages: conversationHistory,
			systemPrompt,
		});
		lastResponse = turnResult.response;
		conversationHistory.push({ role: "assistant", content: lastResponse });
		turns++;
	}

	return {
		lastResponse,
		history: conversationHistory,
		turns,
	};
}
