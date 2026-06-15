import type { Provider } from "../contracts/review.ts";
import type { ToolSpec } from "./tools/index.ts";

export interface AgentSession {
	systemPrompt: string;
	task: string;
	tools: ToolSpec[];
	/** JSON Schema the final output must satisfy. */
	outputSchema: Record<string, unknown>;
	/** Absolute path the agent's tools are sandboxed to. */
	workingDir: string;
	maxTurns?: number;
	/** Allow the runner to additionally expose SDK-native tools. */
	nativeTools?: boolean;
	/** Invoked on each loop turn so the caller can heartbeat Temporal. */
	onProgress?: (note: string) => void;
}

export interface AgentOutcome<T = unknown> {
	output: T;
	usage: { inputTokens: number; outputTokens: number };
	stopReason: "completed" | "max_turns" | "refused";
}

export interface AgentRunner {
	readonly provider: Provider;
	run<T>(session: AgentSession): Promise<AgentOutcome<T>>;
}

/** Lazily-constructed registry so optional providers don't load until used. */
const registry: Partial<Record<Provider, () => Promise<AgentRunner>>> = {
	claude: async () =>
		new (await import("./claude-runner.ts")).ClaudeAgentRunner(),
};

export async function getRunner(provider: Provider): Promise<AgentRunner> {
	const factory = registry[provider];
	if (!factory)
		throw new Error(`No AgentRunner registered for provider "${provider}".`);
	return factory();
}
