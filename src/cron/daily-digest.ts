import { readCronRunLogEntriesPageAll, type CronRunLogEntry } from "./run-log.js";

// ── Daily digest ───────────────────────────────────────────────────────
// Cron agentTurn messages may include a {{dailyDigest}} placeholder; the
// scheduler expands it at run time with a code-built summary of the last
// 24h of scheduled runs (counts, failures, durations). The agent then only
// rewrites/annotates real data — it never has to invent numbers. This is
// what powers the one-click "Morning briefing" job in the Cron UI.

export const DAILY_DIGEST_PLACEHOLDER = "{{dailyDigest}}";

export function messageHasDailyDigestPlaceholder(message: string): boolean {
  return message.includes(DAILY_DIGEST_PLACEHOLDER);
}

export function expandDailyDigestPlaceholder(message: string, digest: string): string {
  return message.replaceAll(DAILY_DIGEST_PLACEHOLDER, digest);
}

type JobSummary = {
  jobId: string;
  name: string;
  ok: number;
  error: number;
  skipped: number;
  lastError?: string;
  totalDurationMs: number;
};

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "0s";
  }
  const seconds = Math.round(ms / 1000);
  if (seconds < 90) {
    return `${seconds}s`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) {
    return `${minutes}m`;
  }
  return `${Math.round(minutes / 60)}h`;
}

export function summarizeCronRunEntries(params: {
  entries: CronRunLogEntry[];
  sinceMs: number;
  jobNameById?: Record<string, string>;
}): string {
  const windowed = params.entries.filter((entry) => entry.ts >= params.sinceMs);
  if (windowed.length === 0) {
    return "No scheduled runs in the last 24 hours.";
  }
  const byJob = new Map<string, JobSummary>();
  let ok = 0;
  let error = 0;
  let skipped = 0;
  for (const entry of windowed) {
    const summary = byJob.get(entry.jobId) ?? {
      jobId: entry.jobId,
      name: params.jobNameById?.[entry.jobId] ?? entry.jobId,
      ok: 0,
      error: 0,
      skipped: 0,
      totalDurationMs: 0,
    };
    if (entry.status === "error") {
      summary.error += 1;
      error += 1;
      if (entry.error) {
        summary.lastError = entry.error;
      }
    } else if (entry.status === "skipped") {
      summary.skipped += 1;
      skipped += 1;
    } else {
      summary.ok += 1;
      ok += 1;
    }
    if (typeof entry.durationMs === "number" && Number.isFinite(entry.durationMs)) {
      summary.totalDurationMs += Math.max(0, entry.durationMs);
    }
    byJob.set(entry.jobId, summary);
  }
  const lines: string[] = [];
  lines.push(
    `Scheduled runs in the last 24h: ${windowed.length} total — ${ok} ok` +
      (error > 0 ? `, ${error} failed` : "") +
      (skipped > 0 ? `, ${skipped} skipped` : "") +
      ".",
  );
  const jobs = [...byJob.values()].toSorted((a, b) => b.error - a.error || b.ok - a.ok);
  for (const job of jobs) {
    const parts: string[] = [];
    if (job.ok > 0) {
      parts.push(`${job.ok} ok`);
    }
    if (job.error > 0) {
      parts.push(`${job.error} failed`);
    }
    if (job.skipped > 0) {
      parts.push(`${job.skipped} skipped`);
    }
    if (job.totalDurationMs > 0) {
      parts.push(`~${formatDuration(job.totalDurationMs)} run time`);
    }
    let line = `• ${job.name}: ${parts.join(", ")}`;
    if (job.lastError) {
      const trimmed = job.lastError.replace(/\s+/g, " ").trim().slice(0, 160);
      line += ` — last error: ${trimmed}`;
    }
    lines.push(line);
  }
  return lines.join("\n");
}

/** Build the last-24h digest by reading the cron run logs next to the store. */
export async function buildCronDailyDigest(params: {
  storePath: string;
  jobNameById?: Record<string, string>;
  now?: number;
}): Promise<string> {
  const now = params.now ?? Date.now();
  const sinceMs = now - 24 * 60 * 60 * 1000;
  try {
    const page = await readCronRunLogEntriesPageAll({
      storePath: params.storePath,
      limit: 200,
      sortDir: "desc",
    });
    return summarizeCronRunEntries({
      entries: page.entries,
      sinceMs,
      jobNameById: params.jobNameById,
    });
  } catch {
    return "No scheduled run history available.";
  }
}
