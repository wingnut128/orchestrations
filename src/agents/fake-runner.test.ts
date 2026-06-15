import { describe, expect, it } from "bun:test";
import { FakeAgentRunner } from "./fake-runner.ts";

describe("FakeAgentRunner", () => {
	it("returns queued outputs in order and records sessions", async () => {
		const runner = new FakeAgentRunner([{ ok: true }, { ok: false }]);
		const a = await runner.run({
			systemPrompt: "s",
			task: "t1",
			tools: [],
			outputSchema: {},
			workingDir: "/tmp",
		});
		const b = await runner.run({
			systemPrompt: "s",
			task: "t2",
			tools: [],
			outputSchema: {},
			workingDir: "/tmp",
		});
		expect(a.output).toEqual({ ok: true });
		expect(b.output).toEqual({ ok: false });
		expect(runner.sessions.map((s) => s.task)).toEqual(["t1", "t2"]);
	});

	it("throws when outputs are exhausted", async () => {
		const runner = new FakeAgentRunner([]);
		await expect(
			runner.run({
				systemPrompt: "s",
				task: "t",
				tools: [],
				outputSchema: {},
				workingDir: "/tmp",
			}),
		).rejects.toThrow(/exhausted/i);
	});
});
