import { z } from "zod";

export const Severity = z.enum(["low", "medium", "high", "critical"]);
export type Severity = z.infer<typeof Severity>;

export const SEVERITY_ORDER: Severity[] = ["low", "medium", "high", "critical"];

export const Provider = z.enum(["claude", "gemini", "codex"]);
export type Provider = z.infer<typeof Provider>;

export const ReviewRequest = z.object({
	owner: z.string().min(1),
	repo: z.string().min(1),
	pr: z.number().int().positive(),
	providerDefault: Provider.default("claude"),
	humanGate: z.boolean().default(false),
	minSeverity: Severity.default("low"),
	completenessCritic: z.boolean().default(false),
});
export type ReviewRequest = z.infer<typeof ReviewRequest>;

export const ReviewDimension = z.object({
	key: z.string().min(1),
	rationale: z.string(),
	scopePaths: z.array(z.string()),
	provider: Provider,
});
export type ReviewDimension = z.infer<typeof ReviewDimension>;

export const ReviewPlan = z.object({
	dimensions: z.array(ReviewDimension),
});
export type ReviewPlan = z.infer<typeof ReviewPlan>;

// The lead agent does NOT choose providers — that's an orchestration concern.
// The schema handed to the LLM omits `provider`; planReview fills it afterward.
export const AgentReviewPlan = z.object({
	dimensions: z.array(ReviewDimension.omit({ provider: true })),
});
export type AgentReviewPlan = z.infer<typeof AgentReviewPlan>;

export const Finding = z.object({
	id: z.string().min(1),
	dimension: z.string().min(1),
	file: z.string().min(1),
	line: z.number().int().positive().optional(),
	severity: Severity,
	title: z.string().min(1),
	body: z.string(),
	suggestedFix: z.string().optional(),
});
export type Finding = z.infer<typeof Finding>;

export const DimensionFindings = z.object({
	dimension: z.string().min(1),
	findings: z.array(Finding),
	coverageNote: z.string(),
});
export type DimensionFindings = z.infer<typeof DimensionFindings>;

export const Verdict = z.object({
	findingId: z.string().min(1),
	real: z.boolean(),
	confidence: z.number().min(0).max(1),
	refutation: z.string().optional(),
});
export type Verdict = z.infer<typeof Verdict>;

export const Usage = z.object({
	inputTokens: z.number().int().nonnegative(),
	outputTokens: z.number().int().nonnegative(),
});
export type Usage = z.infer<typeof Usage>;

export const ReviewReport = z.object({
	summary: z.string(),
	confirmed: z.array(Finding),
	dropped: z.array(Finding),
	byDimension: z.record(z.string(), z.number()),
	dimensionErrors: z.record(z.string(), z.string()),
	usage: Usage,
});
export type ReviewReport = z.infer<typeof ReviewReport>;

// JSON Schemas handed to the LLM for structured output.
export const reviewPlanJsonSchema = z.toJSONSchema(AgentReviewPlan);
export const dimensionFindingsJsonSchema = z.toJSONSchema(DimensionFindings);
export const verdictJsonSchema = z.toJSONSchema(Verdict);
