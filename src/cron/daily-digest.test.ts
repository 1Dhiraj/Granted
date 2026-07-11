import { describe, expect, it } from "vitest";
import {
  DAILY_DIGEST_PLACEHOLDER,
  expandDailyDigestPlaceholder,
  messageHasDailyDigestPlaceholder,
  summarizeCronRunEntries,
} from "./daily-digest.js";
import type { CronRunLogEntry } from "./run-log.js";

const HOUR = 60 * 60 * 1000;

function entry(partial: Partial<CronRunLogEntry> & { ts: number; jobId: string }): CronRunLogEntry {
  return { action: "finished", status: "ok", ...partial };
}

describe("daily digest", () => {
  it("detects and expands the placeholder", () => {
    const message = `Data:\n${DAILY_DIGEST_PLACEHOLDER}\nRewrite it.`;
    expect(messageHasDailyDigestPlaceholder(message)).toBe(true);
    expect(messageHasDailyDigestPlaceholder("plain message")).toBe(false);
    expect(expandDailyDigestPlaceholder(message, "DIGEST")).toBe("Data:\nDIGEST\nRewrite it.");
  });

  it("summarizes runs within the window, worst jobs first", () => {
    const now = Date.now();
    const digest = summarizeCronRunEntries({
      sinceMs: now - 24 * HOUR,
      jobNameById: { a: "watch-inbox", b: "backup" },
      entries: [
        entry({ ts: now - HOUR, jobId: "a", status: "ok", durationMs: 30_000 }),
        entry({ ts: now - 2 * HOUR, jobId: "a", status: "error", error: "boom  went\nthe run" }),
        entry({ ts: now - 3 * HOUR, jobId: "b", status: "ok" }),
        entry({ ts: now - 30 * HOUR, jobId: "b", status: "error", error: "old, outside window" }),
      ],
    });
    expect(digest).toContain("3 total — 2 ok, 1 failed");
    expect(digest).toContain("watch-inbox: 1 ok, 1 failed");
    expect(digest).toContain("last error: boom went the run");
    expect(digest).toContain("• backup: 1 ok");
    expect(digest).not.toContain("outside window");
    // Failing job listed before the healthy one.
    expect(digest.indexOf("watch-inbox")).toBeLessThan(digest.indexOf("• backup"));
  });

  it("reports an empty window honestly", () => {
    expect(
      summarizeCronRunEntries({ sinceMs: Date.now(), entries: [] }),
    ).toBe("No scheduled runs in the last 24 hours.");
  });
});
