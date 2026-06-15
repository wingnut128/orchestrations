export interface ToolContext {
	/** Absolute path the tool calls are sandboxed to. */
	workingDir: string;
}

export interface ToolSpec {
	name: string;
	description: string;
	/** JSON Schema (object) describing the tool input. */
	inputSchema: Record<string, unknown>;
	handler: (
		input: Record<string, unknown>,
		ctx: ToolContext,
	) => Promise<string>;
}
