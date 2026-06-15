import type { Octokit } from "@octokit/rest";
import type { Finding, ReviewReport } from "../contracts/review.ts";

export interface ReviewPayload {
	event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
	body: string;
	comments: { path: string; line: number; body: string }[];
}

function findingComment(f: Finding): string {
	const fix = f.suggestedFix ? `\n\n**Suggested fix:** ${f.suggestedFix}` : "";
	return `**[${f.severity}] ${f.title}** _(${f.dimension})_\n\n${f.body}${fix}`;
}

/** Pure mapping from report → GitHub review payload — unit-testable without the API. */
export function buildReviewPayload(report: ReviewReport): ReviewPayload {
	const comments = report.confirmed
		.filter((f): f is Finding & { line: number } => typeof f.line === "number")
		.map((f) => ({ path: f.file, line: f.line, body: findingComment(f) }));

	const fileless = report.confirmed
		.filter((f) => typeof f.line !== "number")
		.map(findingComment);
	const body = [
		`## Multi-agent review`,
		"",
		report.summary,
		...(fileless.length ? ["", "### Additional findings", ...fileless] : []),
	].join("\n");

	const event = report.confirmed.length === 0 ? "APPROVE" : "REQUEST_CHANGES";
	return { event, body, comments };
}

export async function postReview(
	octokit: Octokit,
	owner: string,
	repo: string,
	pr: number,
	report: ReviewReport,
): Promise<void> {
	const payload = buildReviewPayload(report);
	await octokit.pulls.createReview({
		owner,
		repo,
		pull_number: pr,
		event: payload.event,
		body: payload.body,
		comments: payload.comments,
	});
}
