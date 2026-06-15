import type { Provider } from "../contracts/review.ts";
import type { AgentOutcome, AgentRunner, AgentSession } from "./runner.ts";

/** Deterministic runner for tests — returns queued outputs in order. */
export class FakeAgentRunner implements AgentRunner {
	readonly provider: Provider = "claude";
	readonly sessions: AgentSession[] = [];
	private queue: unknown[];

	constructor(outputs: unknown[]) {
		this.queue = [...outputs];
	}

	async run<T>(session: AgentSession): Promise<AgentOutcome<T>> {
		this.sessions.push(session);
		if (this.queue.length === 0)
			throw new Error("FakeAgentRunner outputs exhausted");
		session.onProgress?.("fake turn");
		return {
			output: this.queue.shift() as T,
			usage: { inputTokens: 10, outputTokens: 20 },
			stopReason: "completed",
		};
	}
}
