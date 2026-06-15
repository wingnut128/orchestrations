import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Octokit } from "@octokit/rest";
import { config } from "../config.ts";
import type { PullRequestContext } from "./types.ts";

export function makeOctokit(): Octokit {
	return new Octokit({
		auth: config.github.token,
		baseUrl: config.github.apiUrl,
	});
}

/** Pure assembler — easy to unit test with a fake Octokit. */
export async function buildPrContext(
	octokit: Octokit,
	owner: string,
	repo: string,
	pr: number,
	workingDir: string,
	diff: string,
): Promise<PullRequestContext> {
	const { data: prData } = await octokit.pulls.get({
		owner,
		repo,
		pull_number: pr,
	});
	const { data: files } = await octokit.pulls.listFiles({
		owner,
		repo,
		pull_number: pr,
		per_page: 300,
	});
	return {
		meta: {
			owner,
			repo,
			pr,
			title: prData.title,
			headSha: prData.head.sha,
			baseSha: prData.base.sha,
			author: prData.user?.login ?? "unknown",
		},
		diff,
		changedFiles: files.map((f) => ({
			path: f.filename,
			status: f.status,
			additions: f.additions ?? 0,
			deletions: f.deletions ?? 0,
		})),
		workingDir,
	};
}

/** Clone the PR into a temp dir. Creates constant refs refs/pr/base and refs/pr/head
 *  (the git_diff agent tool diffs `refs/pr/base refs/pr/head`), then checks out head. */
export async function checkoutPr(
	owner: string,
	repo: string,
	pr: number,
	headSha: string,
	baseSha: string,
): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), `pr-${owner}-${repo}-${pr}-`));
	const cloneUrl = `https://x-access-token:${config.github.token}@github.com/${owner}/${repo}.git`;
	const runGit = async (...args: string[]) => {
		const proc = Bun.spawn(["git", "-C", dir, ...args], {
			stdout: "pipe",
			stderr: "pipe",
		});
		await proc.exited;
		if (proc.exitCode !== 0)
			throw new Error(
				`git ${args.join(" ")} failed: ${await new Response(proc.stderr).text()}`,
			);
	};
	await Bun.spawn(["git", "init", dir]).exited;
	await runGit("remote", "add", "origin", cloneUrl);
	await runGit("fetch", "--depth", "1", "origin", baseSha);
	await runGit("fetch", "--depth", "1", "origin", headSha);
	// Constant refs the git_diff tool diffs against (base vs head).
	await runGit("update-ref", "refs/pr/base", baseSha);
	await runGit("update-ref", "refs/pr/head", headSha);
	// Check out the PR head so read_file/grep see the proposed code.
	await runGit("checkout", headSha);
	return dir;
}

/** Fetch the raw unified diff for a PR via the diff media type. */
export async function fetchPrDiff(
	octokit: Octokit,
	owner: string,
	repo: string,
	pr: number,
): Promise<string> {
	const res = await octokit.pulls.get({
		owner,
		repo,
		pull_number: pr,
		mediaType: { format: "diff" },
	});
	return res.data as unknown as string;
}
