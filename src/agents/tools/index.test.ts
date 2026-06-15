import { describe, expect, it } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { coreTools } from "./index.ts";

async function fixture() {
	const dir = await mkdtemp(join(tmpdir(), "tools-"));
	await writeFile(
		join(dir, "a.ts"),
		"export const x = 1;\nconst secret = 2;\n",
	);
	return dir;
}
const byName = (n: string) => {
	const tool = coreTools.find((t) => t.name === n);
	if (!tool) throw new Error(`Tool "${n}" not found`);
	return tool;
};

describe("core tools", () => {
	it("read_file returns file contents", async () => {
		const dir = await fixture();
		const out = await byName("read_file").handler(
			{ path: "a.ts" },
			{ workingDir: dir },
		);
		expect(out).toContain("export const x = 1;");
	});

	it("read_file refuses path traversal outside workingDir", async () => {
		const dir = await fixture();
		const out = await byName("read_file").handler(
			{ path: "../../etc/passwd" },
			{ workingDir: dir },
		);
		expect(out).toMatch(/outside the working directory|not allowed/i);
	});

	it("grep finds matching lines", async () => {
		const dir = await fixture();
		const out = await byName("grep").handler(
			{ pattern: "secret" },
			{ workingDir: dir },
		);
		expect(out).toContain("a.ts");
		expect(out).toContain("secret");
	});

	it("list_files lists tracked paths", async () => {
		const dir = await fixture();
		const out = await byName("list_files").handler({}, { workingDir: dir });
		expect(out).toContain("a.ts");
	});
});
