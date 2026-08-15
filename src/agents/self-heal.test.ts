import { describe, expect, it } from "vitest";
import { buildSelfHealNudge, isRecoverableFailure } from "./self-heal.js";

describe("isRecoverableFailure", () => {
  it("treats ordinary errors as worth another attempt", () => {
    expect(isRecoverableFailure("ENOENT: no such file or directory")).toBe(true);
    expect(isRecoverableFailure("element not found: e12")).toBe(true);
    expect(isRecoverableFailure("SyntaxError: unexpected token")).toBe(true);
  });

  it("treats human-gated blockers as not worth retrying", () => {
    expect(isRecoverableFailure("permission denied")).toBe(false);
    expect(isRecoverableFailure("CAPTCHA required")).toBe(false);
    expect(isRecoverableFailure("HTTP 401 unauthorized")).toBe(false);
    expect(isRecoverableFailure("spend limit reached")).toBe(false);
  });
});

describe("buildSelfHealNudge", () => {
  it("asks for another attempt when a write failed and was abandoned", () => {
    const nudge = buildSelfHealNudge({
      toolCalls: [{ name: "write", isError: true, error: "ENOENT: directory missing" }],
      replyText: "I tried to create the file.",
    });
    expect(nudge).toContain("failed during this turn");
    expect(nudge).toContain("ENOENT: directory missing");
    expect(nudge).toContain("Do not report the task as done");
  });

  it("stays quiet when the same action succeeded later in the turn", () => {
    expect(
      buildSelfHealNudge({
        toolCalls: [
          { name: "exec", isError: true, error: "command not found: start-notepad" },
          { name: "exec" },
        ],
        replyText: "Notepad is open.",
      }),
    ).toBeNull();
  });

  it("stays quiet when nothing failed", () => {
    expect(
      buildSelfHealNudge({
        toolCalls: [{ name: "write" }, { name: "read" }],
        replyText: "The file has been created.",
      }),
    ).toBeNull();
  });

  it("ignores a failed read — only abandoned state changes need healing", () => {
    expect(
      buildSelfHealNudge({
        toolCalls: [{ name: "read", isError: true, error: "ENOENT" }],
        replyText: "I could not find that file.",
      }),
    ).toBeNull();
  });

  it("stays quiet when a human-gated blocker was already reported honestly", () => {
    expect(
      buildSelfHealNudge({
        toolCalls: [{ name: "browser", action: "click", isError: true, error: "CAPTCHA required" }],
        replyText: "I couldn't continue — the site is blocked by a CAPTCHA that needs you.",
      }),
    ).toBeNull();
  });

  it("still nudges on a hard blocker the model quietly swallowed", () => {
    // Failure hidden behind a cheerful reply is exactly the trust bug.
    expect(
      buildSelfHealNudge({
        toolCalls: [{ name: "browser", action: "click", isError: true, error: "CAPTCHA required" }],
        replyText: "All set!",
      }),
    ).not.toBeNull();
  });

  it("is bounded so a doomed action is not retried forever", () => {
    const params = {
      toolCalls: [{ name: "write", isError: true, error: "ENOENT" }],
      replyText: "Tried it.",
    };
    expect(buildSelfHealNudge({ ...params, attempts: 0 })).not.toBeNull();
    expect(buildSelfHealNudge({ ...params, attempts: 2 })).toBeNull();
    expect(buildSelfHealNudge({ ...params, attempts: 1, maxAttempts: 1 })).toBeNull();
  });

  it("names the specific sub-action that failed", () => {
    const nudge = buildSelfHealNudge({
      toolCalls: [{ name: "desktop", action: "act", isError: true, error: "element e7 not found" }],
      replyText: "Done.",
    });
    expect(nudge).toContain("desktop (act)");
  });
});
