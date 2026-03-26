import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "../activities/claude-agent.ts";

const { claudeAgent } = proxyActivities<typeof activities>({
  startToCloseTimeout: "60s",
});

export async function agentTaskWorkflow(task: string): Promise<string> {
  return await claudeAgent(task);
}
