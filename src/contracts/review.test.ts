import { describe, expect, it } from "bun:test";
import {
	Finding,
	ReviewPlan,
	ReviewRequest,
	reviewPlanJsonSchema,
} from "./review.ts";

describe("review contracts", () => {
	it("applies ReviewRequest defaults", () => {
		const req = ReviewRequest.parse({ owner: "o", repo: "r", pr: 1 });
		expect(req.providerDefault).toBe("claude");
		expect(req.humanGate).toBe(false);
		expect(req.minSeverity).toBe("low");
		expect(req.completenessCritic).toBe(false);
	});

	it("rejects an invalid severity on a Finding", () => {
		const bad = {
			id: "f1",
			dimension: "security",
			file: "a.ts",
			severity: "nope",
			title: "t",
			body: "b",
		};
		expect(() => Finding.parse(bad)).toThrow();
	});

	it("derives a JSON schema for the LLM", () => {
		expect(reviewPlanJsonSchema.type).toBe("object");
		expect(JSON.stringify(reviewPlanJsonSchema)).toContain("dimensions");
	});

	it("accepts a full ReviewPlan", () => {
		const plan = ReviewPlan.parse({
			dimensions: [
				{
					key: "security",
					rationale: "auth touched",
					scopePaths: ["src/auth.ts"],
					provider: "claude",
				},
			],
		});
		expect(plan.dimensions).toHaveLength(1);
	});
});
