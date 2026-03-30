/**
 * Conversation types for multi-turn agent interactions.
 *
 * These are plain TS types with no runtime imports so they can be used
 * inside the Temporal workflow V8 isolate (which has no access to
 * Node/Bun APIs or the Anthropic SDK).
 */

/** A single message in a conversation — structurally compatible with Anthropic.MessageParam. */
export interface ConversationMessage {
	role: "user" | "assistant";
	content: string;
}

/** Full conversation state passed between workflow and activities. */
export interface ConversationContext {
	messages: ConversationMessage[];
	systemPrompt?: string;
}

/** Input for the multi-turn agent task workflow. */
export interface AgentTaskInput {
	/** Initial task/prompt for the agent. */
	task: string;
	/** Optional system prompt to guide agent behavior. */
	systemPrompt?: string;
	/** Resume a previous conversation. */
	history?: ConversationMessage[];
	/** Max turns before the workflow completes (default: 10). */
	maxTurns?: number;
	/** Idle timeout in seconds — how long to wait for a follow-up message (default: 300). */
	idleTimeoutSeconds?: number;
}

/** Result returned by the multi-turn agent task workflow. */
export interface AgentTaskResult {
	/** The last assistant response. */
	lastResponse: string;
	/** Full conversation history. */
	history: ConversationMessage[];
	/** Number of conversation turns completed. */
	turns: number;
}
