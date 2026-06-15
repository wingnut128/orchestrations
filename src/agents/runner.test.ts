import { describe, expect, it } from "bun:test";
import { getRunner } from "./runner.ts";

describe("getRunner", () => {
	it("resolves the claude runner", async () => {
		const runner = await getRunner("claude");
		expect(runner.provider).toBe("claude");
	});

	it("throws an actionable error for unimplemented providers", async () => {
		await expect(getRunner("gemini")).rejects.toThrow(
			/not implemented.*gemini-runner\.ts/s,
		);
		await expect(getRunner("codex")).rejects.toThrow(
			/not implemented.*codex-runner\.ts/s,
		);
	});
});
