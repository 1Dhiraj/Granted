import { describe, expect, it } from "vitest";
import { createProcessTool } from "./bash-tools.process.js";

// Regression: `exec` announces a backgrounded command as "session <name>, pid
// <number>", so callers reach for the pid. Polling with the pid used to return
// a bare "No session found for 14540" — true, but a dead end. In a real
// scorecard run an agent spent its whole remaining budget recovering from it
// and failed a task it had otherwise solved. The error must say what a valid
// identifier looks like.
describe("process tool: unknown session id", () => {
  const runPoll = async (sessionId: string) => {
    const tool = createProcessTool({ scopeKey: "test-scope" });
    const result = await tool.execute("call-1", { action: "poll", sessionId }, undefined, undefined);
    const [first] = result.content as Array<{ type: string; text: string }>;
    return first?.text ?? "";
  };

  it("names the bad identifier so the caller can see what it sent", async () => {
    const text = await runPoll("14540");
    expect(text).toContain("No session found for 14540");
  });

  it("tells the caller how to recover instead of dead-ending", async () => {
    const text = await runPoll("14540");
    // Either there are sessions to name, or it says there are none — never a
    // bare failure with no route forward.
    expect(text).toMatch(/action=list/);
  });

  it("does not leave the caller guessing between pid and session id", async () => {
    const text = await runPoll("14540");
    expect(text).toMatch(/session id, not the pid|No sessions exist right now/);
  });
});
