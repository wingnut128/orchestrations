import { describe, expect, it } from "bun:test";
import type { ReviewReport } from "../contracts/review.ts";
import { buildReviewPayload } from "./post-review.ts";

const report: ReviewReport = {
	summary: "2 issues",
	confirmed: [
		{
			id: "f1",
			dimension: "security",
			file: "src/auth.ts",
			line: 5,
			severity: "high",
			title: "Hardcoded secret",
			body: "...",
		},
		{
			id: "f2",
			dimension: "perf",
			file: "src/x.ts",
			severity: "low",
			title: "N+1",
			body: "...",
		},
	],
	dropped: [],
	byDimension: { security: 1, perf: 1 },
	dimensionErrors: {},
	usage: { inputTokens: 1, outputTokens: 1 },
};

describe("buildReviewPayload", () => {
	it("maps confirmed findings with a line to inline comments and requests changes", () => {
		const payload = buildReviewPayload(report);
		expect(payload.event).toBe("REQUEST_CHANGES");
		expect(payload.comments).toEqual([
			{
				path: "src/auth.ts",
				line: 5,
				body: expect.stringContaining("Hardcoded secret"),
			},
		]);
		expect(payload.body).toContain("2 issues");
	});

	it("approves when there are no confirmed findings", () => {
		const payload = buildReviewPayload({
			...report,
			confirmed: [],
			byDimension: {},
		});
		expect(payload.event).toBe("APPROVE");
		expect(payload.comments).toEqual([]);
	});
});
