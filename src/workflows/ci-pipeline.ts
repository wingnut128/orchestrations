import {
  condition,
  defineQuery,
  defineSignal,
  proxyActivities,
  setHandler,
} from "@temporalio/workflow";
import type * as activities from "../activities/ci-pipeline.ts";

// --- Signals ---

/** Signal that a code review has been completed. */
export const codeReviewCompleteSignal = defineSignal<[{ approved: boolean; reviewer: string }]>(
  "codeReviewComplete",
);

/** Signal that deployment has been approved. */
export const deployApprovalSignal = defineSignal<[{ approved: boolean; approver: string }]>(
  "deployApproval",
);

// --- Queries ---

export const getPipelineStateQuery = defineQuery<PipelineState>("getPipelineState");

// --- Types ---

export type PipelineStage =
  | "queued"
  | "building"
  | "testing"
  | "awaiting-code-review"
  | "awaiting-deploy-approval"
  | "deploying"
  | "completed"
  | "failed";

export interface PipelineState {
  stage: PipelineStage;
  commitSha: string;
  buildResult?: activities.BuildResult;
  testResult?: activities.TestResult;
  codeReview?: {
    reviewId: string;
    approved: boolean;
    reviewer: string;
  };
  deployApproval?: {
    approved: boolean;
    approver: string;
  };
  deployResult?: activities.DeployResult;
  error?: string;
}

// --- Activity proxies ---

const { build, test, requestCodeReview, deploy } = proxyActivities<typeof activities>({
  startToCloseTimeout: "60s",
});

// --- Workflow ---

export async function ciPipelineWorkflow(commitSha: string): Promise<PipelineState> {
  const state: PipelineState = {
    stage: "queued",
    commitSha,
  };

  // Mutable flags set by signal handlers
  let codeReviewReceived = false;
  let deployApprovalReceived = false;

  // Register signal handlers
  setHandler(codeReviewCompleteSignal, ({ approved, reviewer }) => {
    state.codeReview = {
      reviewId: state.codeReview?.reviewId ?? "unknown",
      approved,
      reviewer,
    };
    codeReviewReceived = true;
  });

  setHandler(deployApprovalSignal, ({ approved, approver }) => {
    state.deployApproval = { approved, approver };
    deployApprovalReceived = true;
  });

  // Register query handler
  setHandler(getPipelineStateQuery, () => state);

  // --- Stage 1: Build ---
  state.stage = "building";
  const buildResult = await build(commitSha);
  state.buildResult = buildResult;

  if (!buildResult.success) {
    state.stage = "failed";
    state.error = "Build failed";
    return state;
  }

  // --- Stage 2: Test ---
  state.stage = "testing";
  const testResult = await test(buildResult.artifactUrl);
  state.testResult = testResult;

  if (!testResult.success) {
    state.stage = "failed";
    state.error = `Tests failed: ${testResult.failed} failures`;
    return state;
  }

  // --- Stage 3: Code Review ---
  state.stage = "awaiting-code-review";
  const reviewResult = await requestCodeReview(commitSha);
  state.codeReview = { reviewId: reviewResult.reviewId, approved: false, reviewer: "" };

  // Wait for the code review signal (up to 24 hours)
  const reviewReceived = await condition(() => codeReviewReceived, "24h");
  if (!reviewReceived) {
    state.stage = "failed";
    state.error = "Code review timed out after 24 hours";
    return state;
  }

  if (!state.codeReview.approved) {
    state.stage = "failed";
    state.error = `Code review rejected by ${state.codeReview.reviewer}`;
    return state;
  }

  // --- Stage 4: Deploy Approval ---
  state.stage = "awaiting-deploy-approval";

  // Wait for the deploy approval signal (up to 1 hour)
  const approvalReceived = await condition(() => deployApprovalReceived, "1h");
  if (!approvalReceived) {
    state.stage = "failed";
    state.error = "Deploy approval timed out after 1 hour";
    return state;
  }

  if (!state.deployApproval?.approved) {
    state.stage = "failed";
    state.error = `Deploy rejected by ${state.deployApproval?.approver}`;
    return state;
  }

  // --- Stage 5: Deploy ---
  state.stage = "deploying";
  const deployResult = await deploy(buildResult.artifactUrl, "production");
  state.deployResult = deployResult;

  if (!deployResult.success) {
    state.stage = "failed";
    state.error = "Deployment failed";
    return state;
  }

  state.stage = "completed";
  return state;
}
