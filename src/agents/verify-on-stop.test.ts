import { describe, expect, it } from "vitest";
import {
  buildUnverifiedClaimWarning,
  buildVerifyOnStopNudge,
  claimsSuccess,
  isMutatingCall,
  isVerifyingCall,
} from "./verify-on-stop.js";

describe("claimsSuccess", () => {
  it("catches the real false-success phrasings seen in production", () => {
    expect(claimsSuccess("The file has been created and contains the text.")).toBe(true);
    expect(claimsSuccess("The Windows Calculator app has been launched.")).toBe(true);
    expect(claimsSuccess("The calculation 1+1 has been performed. The result is 2.")).toBe(true);
    expect(claimsSuccess("It's done!")).toBe(true);
  });

  it("ignores descriptions of what a command would do", () => {
    expect(claimsSuccess("This will open the Calculator app for you.")).toBe(false);
    expect(claimsSuccess("You can run `start calc.exe` to open it.")).toBe(false);
  });

  it("ignores acknowledged failures", () => {
    expect(claimsSuccess("I couldn't create the file — the path does not exist.")).toBe(false);
    expect(claimsSuccess("The command failed with an error.")).toBe(false);
  });

  it("ignores empty replies", () => {
    expect(claimsSuccess("")).toBe(false);
  });
});

describe("call classification", () => {
  it("treats writes, edits and GUI actions as mutations", () => {
    expect(isMutatingCall({ name: "write" })).toBe(true);
    expect(isMutatingCall({ name: "desktop", action: "act" })).toBe(true);
    expect(isMutatingCall({ name: "browser", action: "click" })).toBe(true);
    expect(isMutatingCall({ name: "exec", command: "start calc.exe" })).toBe(true);
  });

  it("does not treat read-only shell lookups as mutations", () => {
    expect(isMutatingCall({ name: "exec", command: "Get-PSDrive C" })).toBe(false);
    expect(isMutatingCall({ name: "exec", command: "cat notes.txt" })).toBe(false);
  });

  it("does not treat a failed call as a mutation — that needs a retry, not proof", () => {
    expect(isMutatingCall({ name: "write", isError: true })).toBe(false);
  });

  it("counts reads and snapshots as verification evidence", () => {
    expect(isVerifyingCall({ name: "read" })).toBe(true);
    expect(isVerifyingCall({ name: "desktop", action: "snapshot" })).toBe(true);
    expect(isVerifyingCall({ name: "desktop", action: "read" })).toBe(true);
    expect(isVerifyingCall({ name: "exec", command: "Get-Content out.txt" })).toBe(true);
  });

  it("does not count a failed read as evidence", () => {
    expect(isVerifyingCall({ name: "read", isError: true })).toBe(false);
  });
});

describe("buildVerifyOnStopNudge", () => {
  it("demands verification when a write is claimed but never read back", () => {
    const nudge = buildVerifyOnStopNudge({
      toolCalls: [{ name: "write", command: "notes.txt" }],
      replyText: "The file has been created and contains the text: hello.",
    });
    expect(nudge).toContain("nothing in this turn read the result back");
    expect(nudge).toContain("write");
  });

  it("demands verification for the blind-SendKeys calculator case", () => {
    // Regression: agent fired keystrokes at an unfocused calculator, never read
    // the display, and announced "The result is 2."
    const nudge = buildVerifyOnStopNudge({
      toolCalls: [
        { name: "exec", command: "start calc.exe" },
        { name: "exec", command: "$wshell.SendKeys('1{+}1{=}')" },
      ],
      replyText: "The calculation has been performed. The result is 2.",
    });
    expect(nudge).not.toBeNull();
  });

  it("stays quiet when the agent read the state back after changing it", () => {
    expect(
      buildVerifyOnStopNudge({
        toolCalls: [{ name: "write" }, { name: "read" }],
        replyText: "The file has been created and contains: hello.",
      }),
    ).toBeNull();
  });

  it("stays quiet when a GUI action was confirmed by a fresh snapshot", () => {
    expect(
      buildVerifyOnStopNudge({
        toolCalls: [
          { name: "desktop", action: "act" },
          { name: "desktop", action: "read" },
        ],
        replyText: "The calculator now shows 4.",
      }),
    ).toBeNull();
  });

  it("still fires when the only read happened BEFORE the change", () => {
    // Reading first proves nothing about a change made afterwards.
    expect(
      buildVerifyOnStopNudge({
        toolCalls: [{ name: "read" }, { name: "write" }],
        replyText: "The file has been updated.",
      }),
    ).not.toBeNull();
  });

  it("stays quiet for pure conversation with no state change", () => {
    expect(
      buildVerifyOnStopNudge({
        toolCalls: [{ name: "read" }],
        replyText: "The file contains 42 lines. It's done!",
      }),
    ).toBeNull();
  });

  it("stays quiet when the reply already admits it could not verify", () => {
    expect(
      buildVerifyOnStopNudge({
        toolCalls: [{ name: "write" }],
        replyText: "I ran the write but couldn't confirm the file exists.",
      }),
    ).toBeNull();
  });

  it("is bounded so a stubborn model cannot loop forever", () => {
    const params = {
      toolCalls: [{ name: "write" }],
      replyText: "The file has been created.",
    };
    expect(buildVerifyOnStopNudge({ ...params, attempts: 0 })).not.toBeNull();
    expect(buildVerifyOnStopNudge({ ...params, attempts: 2 })).toBeNull();
    expect(buildVerifyOnStopNudge({ ...params, attempts: 1, maxAttempts: 1 })).toBeNull();
  });

  it("does not demand proof of a change that already failed", () => {
    expect(
      buildVerifyOnStopNudge({
        toolCalls: [{ name: "write", isError: true }],
        replyText: "The file has been created.",
      }),
    ).toBeNull();
  });
});

describe("caller-supplied mutation verdict", () => {
  it("trusts the caller's argument-aware classification over name heuristics", () => {
    // A browser snapshot is not a mutation even though the caller may name it
    // ambiguously; and an exec that looks read-only IS one when args say so.
    expect(isMutatingCall({ name: "browser", mutating: false })).toBe(false);
    expect(isMutatingCall({ name: "exec", command: "cat x", mutating: true })).toBe(true);
  });
});

describe("buildUnverifiedClaimWarning", () => {
  it("flags an unverified claim in one honest line", () => {
    expect(
      buildUnverifiedClaimWarning({
        toolCalls: [{ name: "write" }],
        replyText: "The file has been created.",
      }),
    ).toContain("Unverified");
  });

  it("stays silent when the work was verified", () => {
    expect(
      buildUnverifiedClaimWarning({
        toolCalls: [{ name: "write" }, { name: "read" }],
        replyText: "The file has been created.",
      }),
    ).toBeNull();
  });
});
