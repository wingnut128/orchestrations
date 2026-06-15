import type { ReviewReport } from "../contracts/review.ts";
import { postReview } from "../github/post-review.ts";
import {
	buildPrContext,
	checkoutPr,
	fetchPrDiff,
	makeOctokit,
} from "../github/pr.ts";
import type { PullRequestContext } from "../github/types.ts";

export async function fetchPullRequest(
	owner: string,
	repo: string,
	pr: number,
): Promise<Omit<PullRequestContext, "workingDir">> {
	const octokit = makeOctokit();
	const diff = await fetchPrDiff(octokit, owner, repo, pr);
	const ctx = await buildPrContext(octokit, owner, repo, pr, "", diff);
	const { workingDir: _omit, ...rest } = ctx;
	return rest;
}

export async function checkoutPrToWorkspace(
	owner: string,
	repo: string,
	pr: number,
	headSha: string,
	baseSha: string,
): Promise<string> {
	return checkoutPr(owner, repo, pr, headSha, baseSha);
}

export async function postReviewToGitHub(
	owner: string,
	repo: string,
	pr: number,
	report: ReviewReport,
): Promise<void> {
	await postReview(makeOctokit(), owner, repo, pr, report);
}
