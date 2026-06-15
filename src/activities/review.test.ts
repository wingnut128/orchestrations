import { describe, expect, it } from "bun:test";
import { FakeAgentRunner } from "../agents/fake-runner.ts";
import type { DimensionFindings, Finding } from "../contracts/review.ts";
import {
	runAgentReviewWith,
	synthesizeReviewWith,
	verifyFindingWith,
} from "./review.ts";

const ctx = { owner: "o", repo: "r", pr: 1, headSha: "h", baseSha: "b" };
const finding: Finding = {
	id: "f1",
	dimension: "security",
	file: "a.ts",
	line: 3,
	severity: "high",
	title: "t",
	body: "b",
};

describe("review activities (runner-injected)", () => {
	it("runAgentReview validates worker output against DimensionFindings", async () => {
		const out: DimensionFindings = {
			dimension: "security",
			findings: [finding],
			coverageNote: "ok",
		};
		const runner = new FakeAgentRunner([out]);
		const result = await runAgentReviewWith(
			runner,
			{
				key: "security",
				rationale: "r",
				scopePaths: ["a.ts"],
				provider: "claude",
			},
			"/tmp",
			ctx,
			() => {},
		);
		expect(result.findings.findings[0].id).toBe("f1");
		expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 20 });
	});

	it("runAgentReview throws (non-retryable) on malformed output", async () => {
		const runner = new FakeAgentRunner([{ nope: true }]);
		await expect(
			runAgentReviewWith(
				runner,
				{ key: "security", rationale: "r", scopePaths: [], provider: "claude" },
				"/tmp",
				ctx,
				() => {},
			),
		).rejects.toThrow();
	});

	it("verifyFinding returns majority verdict from M verifiers", async () => {
		// two refute, one supports → real=false
		const runner = new FakeAgentRunner([
			{ findingId: "f1", real: false, confidence: 0.8 },
			{ findingId: "f1", real: false, confidence: 0.7 },
			{ findingId: "f1", real: true, confidence: 0.6 },
		]);
		const verdict = await verifyFindingWith(
			runner,
			finding,
			"/tmp",
			3,
			() => {},
		);
		expect(verdict.verdict.real).toBe(false);
		// usage summed across the 3 verifier calls (10/20 each)
		expect(verdict.usage).toEqual({ inputTokens: 30, outputTokens: 60 });
	});

	it("synthesizeReview assembles a report and counts by dimension", async () => {
		const runner = new FakeAgentRunner([{ summary: "1 issue" }]);
		const report = await synthesizeReviewWith(
			runner,
			[finding],
			[],
			{},
			{ inputTokens: 5, outputTokens: 6 },
			"low",
			() => {},
		);
		expect(report.summary).toBe("1 issue");
		expect(report.confirmed).toHaveLength(1);
		expect(report.byDimension.security).toBe(1);
		// prior usage {5,6} + this synth call {10,20}
		expect(report.usage).toEqual({ inputTokens: 15, outputTokens: 26 });
	});
});
