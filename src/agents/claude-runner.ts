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

/**
 * Convert a ToolSpec's JSON Schema into the Zod raw shape the SDK's tool() wants.
 * Our tools only use object schemas with string properties; required → z.string(),
 * optional → .optional(), and descriptions carry through.
 */
function toZodShape(
	inputSchema: Record<string, unknown>,
): Record<string, z.ZodTypeAny> {
	const props = (inputSchema.properties ?? {}) as Record<
		string,
		{ type?: string; description?: string }
	>;
	const required = new Set(
		(inputSchema.required as string[] | undefined) ?? [],
	);
	const shape: Record<string, z.ZodTypeAny> = {};
	for (const [name, prop] of Object.entries(props)) {
		let field: z.ZodTypeAny = z.string();
		if (prop.description) field = field.describe(prop.description);
		if (!required.has(name)) field = field.optional();
		shape[name] = field;
	}
	return shape;
}

export class ClaudeAgentRunner implements AgentRunner {
	readonly provider: Provider = "claude";

	async run<T>(session: AgentSession): Promise<AgentOutcome<T>> {
		// Build SDK MCP tools from ToolSpec definitions.
		// Each tool's JSON Schema is converted to a proper Zod shape so the model
		// sees typed parameters (path, pattern, etc.) rather than an opaque input blob.
		const sdkTools = session.tools.map((t) =>
			tool(
				t.name,
				t.description,
				toZodShape(t.inputSchema),
				async (args: Record<string, unknown>) => {
					session.onProgress?.(`tool:${t.name}`);
					const text = await t.handler(args, {
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

		// Restrict the available built-in tools when nativeTools is falsy.
		// options.tools (Options['tools'] in sdk.d.ts) is the restriction lever:
		// "Specify the base set of available built-in tools. [] disables all built-in tools."
		// allowedTools only controls auto-approval without prompting — it does NOT restrict.
		const mcpToolIds = session.tools.map((t) => `mcp__review-tools__${t.name}`);

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
				// tools restricts the base set; passing our MCP tool IDs disables all
				// built-ins and exposes only our in-process tools. When nativeTools is
				// true, omit to use all defaults.
				...(session.nativeTools ? {} : { tools: mcpToolIds }),
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
