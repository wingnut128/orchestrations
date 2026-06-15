import { describe, expect, it, mock } from "bun:test";

// Mock the SDK before importing the runner.
mock.module("@anthropic-ai/claude-agent-sdk", () => ({
	tool: (name: string, _desc: string, _schema: unknown, _fn: unknown) => ({
		name,
	}),
	createSdkMcpServer: (cfg: unknown) => ({ cfg }),
	async *query() {
		yield { type: "assistant" };
		yield {
			type: "result",
			subtype: "success",
			result: JSON.stringify({ findingId: "f1", real: false, confidence: 0.9 }),
			usage: { input_tokens: 100, output_tokens: 50 },
		};
	},
}));

const { ClaudeAgentRunner } = await import("./claude-runner.ts");

describe("ClaudeAgentRunner", () => {
	it("parses and validates structured output from the result message", async () => {
		const runner = new ClaudeAgentRunner();
		const outcome = await runner.run({
			systemPrompt: "verify",
			task: "is this real?",
			tools: [],
			outputSchema: { type: "object" },
			workingDir: "/tmp",
		});
		expect(outcome.output).toEqual({
			findingId: "f1",
			real: false,
			confidence: 0.9,
		});
		expect(outcome.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
		expect(outcome.stopReason).toBe("completed");
	});
});
