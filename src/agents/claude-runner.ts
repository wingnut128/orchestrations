import {
	createSdkMcpServer,
	query,
	tool,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Provider } from "../contracts/review.ts";
import type { AgentOutcome, AgentRunner, AgentSession } from "./runner.ts";

const MODEL = "claude-sonnet-4-6";

/**
 * Extract a JSON object from raw agent output text.
 * Handles optional fenced code blocks (```json ... ``` or ``` ... ```).
 */
function extractJson(text: string): unknown {
	const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
	const candidate = fence ? fence[1] : text;
	const start = candidate.indexOf("{");
	const end = candidate.lastIndexOf("}");
	if (start === -1 || end === -1)
		throw new Error("No JSON object found in agent output");
	return JSON.parse(candidate.slice(start, end + 1));
}

export class ClaudeAgentRunner implements AgentRunner {
	readonly provider: Provider = "claude";

	async run<T>(session: AgentSession): Promise<AgentOutcome<T>> {
		// Build SDK MCP tools from ToolSpec definitions.
		// tool() requires a Zod shape; we use a passthrough record and forward to handler.
		const sdkTools = session.tools.map((t) =>
			tool(
				t.name,
				t.description,
				{ input: z.record(z.string(), z.unknown()) },
				async (args: { input: Record<string, unknown> }, _extra: unknown) => {
					session.onProgress?.(`tool:${t.name}`);
					const text = await t.handler(args.input, {
						workingDir: session.workingDir,
					});
					return { content: [{ type: "text" as const, text }] };
				},
			),
		);

		const mcpServer = createSdkMcpServer({
			name: "review-tools",
			tools: sdkTools,
		});

		const system = `${session.systemPrompt}\n\nRespond with ONLY a JSON object matching this schema:\n${JSON.stringify(session.outputSchema)}`;

		let resultText = "";
		let usage = { inputTokens: 0, outputTokens: 0 };
		let stopReason: AgentOutcome["stopReason"] = "completed";

		for await (const msg of query({
			prompt: session.task,
			options: {
				model: MODEL,
				systemPrompt: system,
				maxTurns: session.maxTurns ?? 12,
				mcpServers: { "review-tools": mcpServer },
				allowedTools: session.nativeTools
					? undefined
					: session.tools.map((t) => `mcp__review-tools__${t.name}`),
				cwd: session.workingDir,
			},
		})) {
			session.onProgress?.(`msg:${(msg as { type: string }).type}`);

			if (msg.type === "result") {
				if (msg.subtype === "success") {
					resultText = msg.result ?? "";
				} else {
					// error subtypes: error_max_turns, error_during_execution, etc.
					stopReason =
						msg.subtype === "error_max_turns" ? "max_turns" : "refused";
				}
				usage = {
					inputTokens: msg.usage.input_tokens,
					outputTokens: msg.usage.output_tokens,
				};
			}
		}

		return { output: extractJson(resultText) as T, usage, stopReason };
	}
}
