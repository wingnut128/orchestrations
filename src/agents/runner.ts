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

/**
 * Factory for a provider that has no runner yet. Throws an actionable error
 * pointing at the extension path rather than a generic "not found".
 */
function notImplemented(provider: Provider): () => Promise<AgentRunner> {
	return async () => {
		throw new Error(
			`AgentRunner for provider "${provider}" is not implemented. ` +
				`To add it: create src/agents/${provider}-runner.ts exporting a class that ` +
				`implements AgentRunner (use claude-runner.ts as the template — wrap the ` +
				`provider SDK's tool-use loop, expose the neutral coreTools, and validate ` +
				`structured output), then register its factory in src/agents/runner.ts.`,
		);
	};
}

/**
 * Lazily-constructed registry so optional providers don't load until used.
 * `claude` is implemented; `gemini` and `codex` are documented extension
 * points that fail loudly with guidance until a runner is added.
 */
const registry: Record<Provider, () => Promise<AgentRunner>> = {
	claude: async () =>
		new (await import("./claude-runner.ts")).ClaudeAgentRunner(),
	gemini: notImplemented("gemini"),
	codex: notImplemented("codex"),
};

export async function getRunner(provider: Provider): Promise<AgentRunner> {
	const factory = registry[provider];
	if (!factory) throw new Error(`Unknown provider "${provider}".`);
	return factory();
}
