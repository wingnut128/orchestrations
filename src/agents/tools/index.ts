import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { ToolSpec } from "./types.ts";

export type { ToolContext, ToolSpec } from "./types.ts";

/** Resolve a user-supplied path and guarantee it stays inside workingDir. */
function safeResolve(workingDir: string, p: string): string | null {
	const abs = isAbsolute(p) ? p : resolve(workingDir, p);
	const rel = relative(workingDir, abs);
	if (rel.startsWith("..") || isAbsolute(rel)) return null;
	return abs;
}

async function walk(dir: string, base: string, acc: string[]): Promise<void> {
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		if (entry.name === ".git" || entry.name === "node_modules") continue;
		const full = join(dir, entry.name);
		if (entry.isDirectory()) await walk(full, base, acc);
		else acc.push(relative(base, full));
	}
}

const readFileTool: ToolSpec = {
	name: "read_file",
	description:
		"Read a UTF-8 text file from the review workspace by relative path.",
	inputSchema: {
		type: "object",
		properties: {
			path: {
				type: "string",
				description: "Path relative to the workspace root.",
			},
		},
		required: ["path"],
	},
	handler: async (input, ctx) => {
		const abs = safeResolve(ctx.workingDir, String(input.path));
		if (!abs)
			return `Error: path "${input.path}" is outside the working directory.`;
		try {
			return await readFile(abs, "utf8");
		} catch (err) {
			return `Error reading ${input.path}: ${(err as Error).message}`;
		}
	},
};

const grepTool: ToolSpec = {
	name: "grep",
	description:
		"Search workspace files for a substring (case-sensitive). Returns matching lines as path:line:text.",
	inputSchema: {
		type: "object",
		properties: {
			pattern: { type: "string" },
			path: {
				type: "string",
				description: "Optional subdirectory to limit the search.",
			},
		},
		required: ["pattern"],
	},
	handler: async (input, ctx) => {
		const root = input.path
			? safeResolve(ctx.workingDir, String(input.path))
			: ctx.workingDir;
		if (!root)
			return `Error: path "${input.path}" is outside the working directory.`;
		const pattern = String(input.pattern);
		const files: string[] = [];
		await walk(root, ctx.workingDir, files);
		const lines: string[] = [];
		for (const rel of files) {
			const abs = join(ctx.workingDir, rel);
			try {
				if ((await stat(abs)).size > 1_000_000) continue;
				const text = await readFile(abs, "utf8");
				text.split("\n").forEach((l, i) => {
					if (l.includes(pattern)) lines.push(`${rel}:${i + 1}:${l.trim()}`);
				});
			} catch {
				/* skip unreadable/binary files */
			}
			if (lines.length >= 200) break;
		}
		return lines.length ? lines.join("\n") : `No matches for "${pattern}".`;
	},
};

const listFilesTool: ToolSpec = {
	name: "list_files",
	description:
		"List all files in the workspace (relative paths), excluding .git and node_modules.",
	inputSchema: { type: "object", properties: {} },
	handler: async (_input, ctx) => {
		const acc: string[] = [];
		await walk(ctx.workingDir, ctx.workingDir, acc);
		return acc.sort().join("\n");
	},
};

const gitDiffTool: ToolSpec = {
	name: "git_diff",
	description:
		"Show the unified diff of the PR (base..head) for an optional path.",
	inputSchema: {
		type: "object",
		properties: {
			path: { type: "string", description: "Optional path to limit the diff." },
		},
	},
	handler: async (input, ctx) => {
		const args = ["-C", ctx.workingDir, "diff", "--no-color", "HEAD~1...HEAD"];
		if (input.path) args.push("--", String(input.path));
		const proc = Bun.spawn(["git", ...args], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const out = await new Response(proc.stdout).text();
		await proc.exited;
		return out || "No diff.";
	},
};

export const coreTools: ToolSpec[] = [
	readFileTool,
	grepTool,
	listFilesTool,
	gitDiffTool,
];
