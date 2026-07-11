// ── Job-file parsing ───────────────────────────────────────────────────
// A "job" is a jobs/*.md checklist in an agent workspace. The heartbeat
// auto-resumes any job with unchecked boxes; the gateway's agents.jobs.list
// reports checkbox progress so the UI can show pending/running/done and let
// the user resume one on demand. Pure + unit-tested so the RPC stays thin.

export type JobStatus = "done" | "in-progress" | "pending" | "note";

export type JobFileSummary = {
  title: string;
  done: number;
  total: number;
  status: JobStatus;
};

const CHECKBOX_RE = /^\s*[-*]\s*\[( |x|X)\]/gm;
const CHECKED_RE = /\[(x|X)\]/;
const HEADING_RE = /^#\s+(.+)$/m;

/** Parse a job markdown file's checkbox progress and title. */
export function parseJobFile(fileName: string, content: string): JobFileSummary {
  const boxes = content.match(CHECKBOX_RE) ?? [];
  const total = boxes.length;
  const done = boxes.filter((box) => CHECKED_RE.test(box)).length;
  const heading = content.match(HEADING_RE)?.[1]?.trim();
  const status: JobStatus =
    total === 0 ? "note" : done >= total ? "done" : done > 0 ? "in-progress" : "pending";
  return {
    title: heading || fileName.replace(/\.md$/i, ""),
    done,
    total,
    status,
  };
}
