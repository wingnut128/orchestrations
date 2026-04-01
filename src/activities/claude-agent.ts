import Anthropic from "@anthropic-ai/sdk";
import { traceClaudeCall } from "../telemetry/instrumentation.ts";
import type {
	ConversationContext,
	ConversationMessage,
} from "../types/conversation.ts";

const client = new Anthropic();
const MODEL = "claude-sonnet-4-6";

/** Single-shot Claude agent call (backward-compatible). */
export async function claudeAgent(
	prompt: string,
	systemPrompt?: string,
): Promise<string> {
	const result = await claudeAgentConverse({
		messages: [{ role: "user", content: prompt }],
		systemPrompt,
	});
	return result.response;
}

/** Multi-turn Claude agent call — accepts and returns conversation history. */
export async function claudeAgentConverse(
	context: ConversationContext,
): Promise<{ response: string; updatedHistory: ConversationMessage[] }> {
	console.log(
		`[activity] claudeAgentConverse called with ${context.messages.length} message(s)`,
	);

	return traceClaudeCall(
		"claude.messages.create",
		{ model: MODEL, messageCount: context.messages.length },
		async (span) => {
			const response = await client.messages.create({
				model: MODEL,
				max_tokens: 4096,
				...(context.systemPrompt ? { system: context.systemPrompt } : {}),
				messages: context.messages,
			});

			const text = response.content
				.filter((block): block is Anthropic.TextBlock => block.type === "text")
				.map((block) => block.text)
				.join("\n");

			span.setAttribute("ai.usage.input_tokens", response.usage.input_tokens);
			span.setAttribute("ai.usage.output_tokens", response.usage.output_tokens);

			console.log(
				`[activity] claudeAgentConverse response: ${text.length} chars, ` +
					`tokens: ${response.usage.input_tokens} in / ${response.usage.output_tokens} out`,
			);

			const updatedHistory: ConversationMessage[] = [
				...context.messages,
				{ role: "assistant", content: text },
			];

			return { response: text, updatedHistory };
		},
	);
}
