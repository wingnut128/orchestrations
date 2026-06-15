import {
	type ChildWorkflowHandle,
	condition,
	defineSignal,
	proxyActivities,
	setHandler,
	startChild,
	uuid4,
	workflowInfo,
} from "@temporalio/workflow";
import type * as ghActivities from "../activities/github.ts";
import type * as reviewActivities from "../activities/review.ts";
import type {
	DimensionFindings,
	Finding,
	ReviewReport,
	ReviewRequest,
} from "../contracts/review.ts";
import type { PullRequestContext } from "../github/types.ts";
import { reviewWorkerWorkflow } from "./review-worker.ts";
import { verifyFindingWorkflow } from "./verify-finding.ts";

// Child workflows must be exported from the bundle entrypoint so Temporal can
// instantiate them when they are started via startChild().
export { reviewWorkerWorkflow, verifyFindingWorkflow };

const VERIFIER_COUNT = 3;

const { fetchPullRequest, checkoutPrToWorkspace, postReviewToGitHub } =
	proxyActivities<typeof ghActivities>({
		startToCloseTimeout: "120s",
		retry: { maximumAttempts: 3 },
	});
const { planReview, completenessCritic, synthesizeReview } = proxyActivities<
	typeof reviewActivities
>({
	startToCloseTimeout: "300s",
	heartbeatTimeout: "30s",
	retry: { maximumAttempts: 3 },
});

export interface PostDecision {
	decision: "post" | "abort";
	decidedBy: string;
}
export const postReviewDecisionSignal =
	defineSignal<[PostDecision]>("postReviewDecision");

export async function reviewOrchestratorWorkflow(
	req: ReviewRequest,
): Promise<ReviewReport> {
	let decision: PostDecision | undefined;
	setHandler(postReviewDecisionSignal, (d) => {
		decision = d;
	});

	// 1–2. Fetch + checkout
	const prData = await fetchPullRequest(req.owner, req.repo, req.pr);
	const workingDir = await checkoutPrToWorkspace(
		req.owner,
		req.repo,
		req.pr,
		prData.meta.headSha,
		prData.meta.baseSha,
	);
	const pr: PullRequestContext = { ...prData, workingDir };
	const prRef = {
		owner: req.owner,
		repo: req.repo,
		pr: req.pr,
		headSha: prData.meta.headSha,
		baseSha: prData.meta.baseSha,
	};

	// 3. Lead agent plans dimensions
	const plan = await planReview(pr, req.providerDefault);
	let dimensions = plan.dimensions;

	const dimensionErrors: Record<string, string> = {};
	const allFindings: Finding[] = [];
	const coveredKeys = new Set<string>();

	// 4–5. Fan-out workers → fan-in (degrade gracefully on failure)
	async function runRound(dims: typeof dimensions): Promise<void> {
		const handles = await Promise.all(
			dims.map((d) =>
				startChild(reviewWorkerWorkflow, {
					args: [{ dimension: d, workingDir, pr: prRef }],
					workflowId: `${workflowInfo().workflowId}-worker-${d.key}-${uuid4()}`,
				}),
			),
		);
		const settled = await Promise.allSettled(
			handles.map((h: ChildWorkflowHandle<typeof reviewWorkerWorkflow>) =>
				h.result(),
			),
		);
		settled.forEach((r, i) => {
			const key = dims[i].key;
			coveredKeys.add(key);
			if (r.status === "fulfilled")
				allFindings.push(...(r.value as DimensionFindings).findings);
			else dimensionErrors[key] = String(r.reason);
		});
	}
	await runRound(dimensions);

	// 6b. Optional completeness critic (bounded loop-until-dry, max 1 extra round)
	if (req.completenessCritic) {
		const extra = await completenessCritic(
			pr,
			[...coveredKeys],
			req.providerDefault,
		);
		const fresh = extra.dimensions.filter((d) => !coveredKeys.has(d.key));
		if (fresh.length > 0) {
			dimensions = fresh;
			await runRound(fresh);
		}
	}

	// 6. Verify each finding (fan-out → fan-in), keep majority-real
	const verifyHandles = await Promise.all(
		allFindings.map((f) =>
			startChild(verifyFindingWorkflow, {
				args: [
					{
						finding: f,
						workingDir,
						provider: req.providerDefault,
						verifierCount: VERIFIER_COUNT,
					},
				],
				workflowId: `${workflowInfo().workflowId}-verify-${f.id}-${uuid4()}`,
			}),
		),
	);
	const verdicts = await Promise.all(verifyHandles.map((h) => h.result()));
	const confirmed: Finding[] = [];
	const dropped: Finding[] = [];
	allFindings.forEach((f, i) => {
		(verdicts[i].real ? confirmed : dropped).push(f);
	});

	// 7. Synthesize
	const report = await synthesizeReview(
		confirmed,
		dropped,
		dimensionErrors,
		{ inputTokens: 0, outputTokens: 0 },
		req.minSeverity,
		req.providerDefault,
	);

	// 8. Optional human gate
	if (req.humanGate) {
		const got = await condition(() => decision !== undefined, "1h");
		if (!got || decision?.decision === "abort") return report;
	}

	// 9. Post back to GitHub
	await postReviewToGitHub(req.owner, req.repo, req.pr, report);
	return report;
}
