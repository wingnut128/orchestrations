import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { WorkflowFailedError } from "@temporalio/client";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { ApplicationFailure } from "@temporalio/workflow";
import {
	addUserMessageSignal,
	getConversationHistoryQuery,
} from "../signals/agent-protocol.ts";
import type { AgentTaskInput, AgentTaskResult } from "../types/conversation.ts";

let testEnv: TestWorkflowEnvironment;

beforeAll(async () => {
	testEnv = await TestWorkflowEnvironment.createLocal();
}, 30_000);

afterAll(async () => {
	await testEnv?.teardown();
});

const workflowsPath = new URL("./agent-task.ts", import.meta.url).pathname;

describe("agentTaskWorkflow", () => {
	describe("single-shot (backward-compatible)", () => {
		it("returns the mocked Claude agent response", async () => {
			const { client, nativeConnection } = testEnv;
			const taskQueue = "test-agent-happy";

			const worker = await Worker.create({
				connection: nativeConnection,
				taskQueue,
				workflowsPath,
				activities: {
					claudeAgent: async (_task: string) =>
						"This is a mocked Claude response.",
					claudeAgentConverse: async () => ({
						response: "unused",
						updatedHistory: [],
					}),
				},
			});

			const result = await worker.runUntil(
				client.workflow.execute("agentTaskWorkflow", {
					args: ["Summarize this document"],
					workflowId: "test-agent-happy-path",
					taskQueue,
				}),
			);

			expect(result).toBe("This is a mocked Claude response.");
		});

		it("propagates activity failure to the workflow", async () => {
			const { client, nativeConnection } = testEnv;
			const taskQueue = "test-agent-failure";

			const worker = await Worker.create({
				connection: nativeConnection,
				taskQueue,
				workflowsPath,
				activities: {
					claudeAgent: async (_task: string) => {
						throw ApplicationFailure.nonRetryable("Claude API is down");
					},
					claudeAgentConverse: async () => {
						throw ApplicationFailure.nonRetryable("Claude API is down");
					},
				},
			});

			try {
				await worker.runUntil(
					client.workflow.execute("agentTaskWorkflow", {
						args: ["Do something"],
						workflowId: "test-agent-failure-path",
						taskQueue,
					}),
				);
				expect(true).toBe(false);
			} catch (err) {
				expect(err).toBeInstanceOf(WorkflowFailedError);
				const wfErr = err as WorkflowFailedError;
				const rootCause = wfErr.cause?.cause;
				expect(rootCause?.message).toContain("Claude API is down");
			}
		});
	});

	describe("multi-turn conversation", () => {
		it("completes initial turn and returns result on idle timeout", async () => {
			const { client, nativeConnection } = testEnv;
			const taskQueue = "test-multi-turn-single";

			const worker = await Worker.create({
				connection: nativeConnection,
				taskQueue,
				workflowsPath,
				activities: {
					claudeAgent: async () => "unused",
					claudeAgentConverse: async () => ({
						response: "Hello! How can I help?",
						updatedHistory: [],
					}),
				},
			});

			const input: AgentTaskInput = {
				task: "Hi there",
				idleTimeoutSeconds: 1,
			};

			const result = (await worker.runUntil(
				client.workflow.execute("agentTaskWorkflow", {
					args: [input],
					workflowId: "test-multi-turn-single",
					taskQueue,
				}),
			)) as AgentTaskResult;

			expect(result.turns).toBe(1);
			expect(result.lastResponse).toBe("Hello! How can I help?");
			expect(result.history).toHaveLength(2);
			expect(result.history[0]).toEqual({ role: "user", content: "Hi there" });
			expect(result.history[1]).toEqual({
				role: "assistant",
				content: "Hello! How can I help?",
			});
		});

		it("handles follow-up messages via signal", async () => {
			const { client, nativeConnection } = testEnv;
			const taskQueue = "test-multi-turn-followup";
			let callCount = 0;

			const worker = await Worker.create({
				connection: nativeConnection,
				taskQueue,
				workflowsPath,
				activities: {
					claudeAgent: async () => "unused",
					claudeAgentConverse: async () => {
						callCount++;
						const responses: Record<number, string> = {
							1: "I can help with Temporal!",
							2: "Workflows are deterministic orchestrators.",
						};
						return {
							response: responses[callCount] ?? "Default response",
							updatedHistory: [],
						};
					},
				},
			});

			const input: AgentTaskInput = {
				task: "Tell me about Temporal",
				idleTimeoutSeconds: 5,
			};

			const result = (await worker.runUntil(async () => {
				const handle = await client.workflow.start("agentTaskWorkflow", {
					args: [input],
					workflowId: "test-multi-turn-followup",
					taskQueue,
				});

				// Poll until first turn completes
				let history = await handle.query(getConversationHistoryQuery);
				for (let i = 0; i < 20 && history.length < 2; i++) {
					await sleep(200);
					history = await handle.query(getConversationHistoryQuery);
				}

				await handle.signal(addUserMessageSignal, "What are workflows?");
				return await handle.result();
			})) as AgentTaskResult;

			expect(result.turns).toBe(2);
			expect(result.history).toHaveLength(4);
			expect(result.history[0].role).toBe("user");
			expect(result.history[1].role).toBe("assistant");
			expect(result.history[2]).toEqual({
				role: "user",
				content: "What are workflows?",
			});
			expect(result.history[3].role).toBe("assistant");
		}, 15_000);

		it("respects maxTurns limit", async () => {
			const { client, nativeConnection } = testEnv;
			const taskQueue = "test-multi-turn-max";
			let callCount = 0;

			const worker = await Worker.create({
				connection: nativeConnection,
				taskQueue,
				workflowsPath,
				activities: {
					claudeAgent: async () => "unused",
					claudeAgentConverse: async () => {
						callCount++;
						return {
							response: `Response ${callCount}`,
							updatedHistory: [],
						};
					},
				},
			});

			const input: AgentTaskInput = {
				task: "Start",
				maxTurns: 2,
				idleTimeoutSeconds: 5,
			};

			const result = (await worker.runUntil(async () => {
				const handle = await client.workflow.start("agentTaskWorkflow", {
					args: [input],
					workflowId: "test-multi-turn-max",
					taskQueue,
				});

				// Poll until first turn, then send follow-up
				let history = await handle.query(getConversationHistoryQuery);
				for (let i = 0; i < 20 && history.length < 2; i++) {
					await sleep(200);
					history = await handle.query(getConversationHistoryQuery);
				}

				await handle.signal(addUserMessageSignal, "Continue");
				return await handle.result();
			})) as AgentTaskResult;

			expect(result.turns).toBe(2);
		}, 15_000);

		it("exposes conversation history via query", async () => {
			const { client, nativeConnection } = testEnv;
			const taskQueue = "test-multi-turn-query";

			const worker = await Worker.create({
				connection: nativeConnection,
				taskQueue,
				workflowsPath,
				activities: {
					claudeAgent: async () => "unused",
					claudeAgentConverse: async () => ({
						response: "Queried response",
						updatedHistory: [],
					}),
				},
			});

			const input: AgentTaskInput = {
				task: "Query test",
				idleTimeoutSeconds: 1,
			};

			const handle = await client.workflow.start("agentTaskWorkflow", {
				args: [input],
				workflowId: "test-multi-turn-query",
				taskQueue,
			});

			const result = (await worker.runUntil(async () => {
				// Poll until first turn completes
				let history = await handle.query(getConversationHistoryQuery);
				const maxAttempts = 20;
				for (let i = 0; i < maxAttempts && history.length < 2; i++) {
					await sleep(200);
					history = await handle.query(getConversationHistoryQuery);
				}

				expect(history).toHaveLength(2);
				expect(history[0]).toEqual({ role: "user", content: "Query test" });
				expect(history[1]).toEqual({
					role: "assistant",
					content: "Queried response",
				});

				return await handle.result();
			})) as AgentTaskResult;

			expect(result.turns).toBe(1);
		}, 15_000);

		it("resumes from prior conversation history", async () => {
			const { client, nativeConnection } = testEnv;
			const taskQueue = "test-multi-turn-resume";

			const worker = await Worker.create({
				connection: nativeConnection,
				taskQueue,
				workflowsPath,
				activities: {
					claudeAgent: async () => "unused",
					claudeAgentConverse: async () => ({
						response: "Continuing where we left off.",
						updatedHistory: [],
					}),
				},
			});

			const input: AgentTaskInput = {
				task: "What were we talking about?",
				history: [
					{ role: "user", content: "Previous question" },
					{ role: "assistant", content: "Previous answer" },
				],
				idleTimeoutSeconds: 1,
			};

			const result = (await worker.runUntil(
				client.workflow.execute("agentTaskWorkflow", {
					args: [input],
					workflowId: "test-multi-turn-resume",
					taskQueue,
				}),
			)) as AgentTaskResult;

			expect(result.turns).toBe(1);
			// History includes resumed messages + new turn
			expect(result.history).toHaveLength(4);
			expect(result.history[0].content).toBe("Previous question");
			expect(result.history[1].content).toBe("Previous answer");
			expect(result.history[2].content).toBe("What were we talking about?");
			expect(result.history[3].content).toBe("Continuing where we left off.");
		});
	});
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
