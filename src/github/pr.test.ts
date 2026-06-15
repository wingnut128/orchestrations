import { describe, expect, it } from "bun:test";
import { buildPrContext } from "./pr.ts";

const fakeOctokit = {
	pulls: {
		get: async () => ({
			data: {
				title: "Add auth",
				head: { sha: "headsha" },
				base: { sha: "basesha" },
				user: { login: "alice" },
			},
		}),
		listFiles: async () => ({
			data: [
				{
					filename: "src/auth.ts",
					status: "modified",
					additions: 10,
					deletions: 2,
				},
			],
		}),
	},
} as unknown as import("@octokit/rest").Octokit;

describe("buildPrContext", () => {
	it("assembles PR metadata and changed files", async () => {
		const ctx = await buildPrContext(
			fakeOctokit,
			"o",
			"r",
			7,
			"/tmp/wd",
			"raw diff",
		);
		expect(ctx.meta).toEqual({
			owner: "o",
			repo: "r",
			pr: 7,
			title: "Add auth",
			headSha: "headsha",
			baseSha: "basesha",
			author: "alice",
		});
		expect(ctx.changedFiles[0].path).toBe("src/auth.ts");
		expect(ctx.diff).toBe("raw diff");
		expect(ctx.workingDir).toBe("/tmp/wd");
	});
});
