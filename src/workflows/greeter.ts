import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "../activities/greeter.ts";

const { greet } = proxyActivities<typeof activities>({
  startToCloseTimeout: "10s",
});

export async function greeterWorkflow(name: string): Promise<string> {
  return await greet(name);
}
