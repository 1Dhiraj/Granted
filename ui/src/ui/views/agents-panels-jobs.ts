import { html, nothing } from "lit";

// ── Jobs panel ─────────────────────────────────────────────────────────
// Long-running task files (jobs/*.md in the agent workspace). Each file is
// a checklist; the gateway reports checkbox progress. Unchecked jobs are
// auto-resumed by the heartbeat — this panel makes them visible and lets
// the user resume one on demand.

export type AgentJobEntry = {
  name: string;
  title: string;
  done: number;
  total: number;
  status: "done" | "in-progress" | "pending" | "note";
  updatedAtMs: number;
};

export type AgentJobsResult = {
  agentId: string;
  jobs: AgentJobEntry[];
};

const STATUS_LABELS: Record<AgentJobEntry["status"], string> = {
  done: "Done",
  "in-progress": "In progress",
  pending: "Pending",
  note: "Note",
};

function formatRelativeTime(ms: number): string {
  const delta = Date.now() - ms;
  if (!Number.isFinite(delta) || delta < 0) {
    return "just now";
  }
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return `${hours}h ago`;
  }
  return `${Math.floor(hours / 24)}d ago`;
}

export function renderAgentJobs(props: {
  loading: boolean;
  error: string | null;
  result: AgentJobsResult | null;
  agentWorking: boolean;
  onRefresh: () => void;
  onResume: (jobName: string) => void;
}) {
  const jobs = props.result?.jobs ?? [];
  return html`
    <section class="card">
      <div class="agent-jobs-head">
        <div>
          <div class="card-title">Jobs</div>
          <div class="card-sub">
            Long-running tasks the agent works through as checklists
            (<code>jobs/*.md</code>). Unfinished jobs auto-resume on the heartbeat.
          </div>
        </div>
        <button class="btn btn--subtle btn--sm" ?disabled=${props.loading} @click=${props.onRefresh}>
          ${props.loading ? "Loading…" : "Refresh"}
        </button>
      </div>
      ${props.error ? html`<div class="callout danger">${props.error}</div>` : nothing}
      ${!props.error && !props.loading && jobs.length === 0
        ? html`<p class="agent-jobs-empty">
            No job files yet. Ask the agent to “start a job” for any long task — it will create
            a checklist in <code>jobs/</code>, work through it, and pick it back up after
            restarts until every box is checked.
          </p>`
        : nothing}
      ${jobs.length > 0
        ? html`
            <div class="agent-jobs-list">
              ${jobs.map((job) => {
                const resumable = job.status === "pending" || job.status === "in-progress";
                return html`
                  <div class="agent-job-row agent-job-row--${job.status}">
                    <span class="agent-job-status">${STATUS_LABELS[job.status]}</span>
                    <span class="agent-job-body">
                      <span class="agent-job-title">${job.title}</span>
                      <span class="agent-job-meta">
                        ${job.total > 0 ? `${job.done}/${job.total} tasks · ` : ""}${job.name} ·
                        updated ${formatRelativeTime(job.updatedAtMs)}
                      </span>
                    </span>
                    ${job.total > 0
                      ? html`<span class="agent-job-progress">
                          <span
                            class="agent-job-progress-fill"
                            style="width:${job.total > 0
                              ? Math.round((job.done / job.total) * 100)
                              : 0}%"
                          ></span>
                        </span>`
                      : nothing}
                    ${resumable
                      ? html`<button
                          class="btn btn--sm agent-job-resume"
                          title=${props.agentWorking
                            ? "Agent is busy — the job will queue after the current run"
                            : "Tell the agent to continue this job now"}
                          @click=${() => props.onResume(job.name)}
                        >
                          Resume ▸
                        </button>`
                      : nothing}
                  </div>
                `;
              })}
            </div>
          `
        : nothing}
    </section>
  `;
}
