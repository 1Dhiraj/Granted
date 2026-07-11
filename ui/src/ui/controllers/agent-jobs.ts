import type { GatewayBrowserClient } from "../gateway.ts";
import type { AgentJobsResult } from "../views/agents-panels-jobs.ts";

export type AgentJobsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  agentJobsLoading: boolean;
  agentJobsError: string | null;
  agentJobsResult: AgentJobsResult | null;
};

export async function loadAgentJobs(state: AgentJobsState, agentId: string) {
  if (!state.client || !state.connected || state.agentJobsLoading) {
    return;
  }
  state.agentJobsLoading = true;
  state.agentJobsError = null;
  try {
    const res = await state.client.request<AgentJobsResult | null>("agents.jobs.list", {
      agentId,
    });
    if (res) {
      state.agentJobsResult = res;
    }
  } catch (err) {
    state.agentJobsError = String(err);
  } finally {
    state.agentJobsLoading = false;
  }
}

/** The message sent to an agent to pick a job back up. */
export function buildResumeJobMessage(jobName: string): string {
  return `Resume the job in jobs/${jobName}: read it, do the next unchecked step, check it off, and continue until every box is done. If you hit a blocker, note it in the file and stop.`;
}
