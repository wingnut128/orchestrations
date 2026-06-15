import { describe, expect, it } from "bun:test";

const live = process.env.ANTHROPIC_API_KEY && process.env.GITHUB_TOKEN;
const maybe = live ? describe : describe.skip;

maybe("live review activities", () => {
	it("plans dimensions for a real small PR", async () => {
		const { fetchPullRequest, checkoutPrToWorkspace } = await import(
			"./github.ts"
		);
		const { planReview } = await import("./review.ts");
		const owner = process.env.IT_OWNER ?? "wingnut128";
		const repo = process.env.IT_REPO ?? "orchestrations";
		const pr = Number.parseInt(process.env.IT_PR ?? "49", 10);
		const data = await fetchPullRequest(owner, repo, pr);
		const wd = await checkoutPrToWorkspace(
			owner,
			repo,
			pr,
			data.meta.headSha,
			data.meta.baseSha,
		);
		const plan = await planReview({ ...data, workingDir: wd }, "claude");
		expect(plan.dimensions.length).toBeGreaterThan(0);
	}, 120_000);
});
