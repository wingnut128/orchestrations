export interface BuildResult {
  success: boolean;
  artifactUrl: string;
  durationMs: number;
}

export interface TestResult {
  success: boolean;
  passed: number;
  failed: number;
  skipped: number;
}

export interface CodeReviewResult {
  reviewId: string;
  status: "pending";
}

export interface DeployResult {
  success: boolean;
  environment: string;
  deploymentUrl: string;
}

export async function build(commitSha: string): Promise<BuildResult> {
  console.log(`[activity] build started for commit ${commitSha}`);
  // Stub: simulate build duration
  return {
    success: true,
    artifactUrl: `https://artifacts.example.com/${commitSha}.tar.gz`,
    durationMs: 42_000,
  };
}

export async function test(artifactUrl: string): Promise<TestResult> {
  console.log(`[activity] test started for artifact ${artifactUrl}`);
  return {
    success: true,
    passed: 127,
    failed: 0,
    skipped: 3,
  };
}

export async function requestCodeReview(commitSha: string): Promise<CodeReviewResult> {
  console.log(`[activity] code review requested for commit ${commitSha}`);
  return {
    reviewId: `review-${commitSha.slice(0, 7)}`,
    status: "pending",
  };
}

export async function deploy(
  artifactUrl: string,
  environment: string,
): Promise<DeployResult> {
  console.log(`[activity] deploy started to ${environment} from ${artifactUrl}`);
  return {
    success: true,
    environment,
    deploymentUrl: `https://${environment}.example.com`,
  };
}
