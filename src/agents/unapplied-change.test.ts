import { describe, expect, it } from "vitest";
import { describesUnappliedChange, turnWroteFiles } from "./unapplied-change.js";

describe("describesUnappliedChange", () => {
  // Verbatim shape of the real failure: correct diagnosis, corrected code,
  // a promise to run it, and not one mutating tool call.
  const realCase = [
    "To fix this, we need to change the `add` function to return `a + b` instead of `a - b`.",
    "",
    "Here is the corrected code:",
    "",
    "```javascript",
    "export function add(a, b) {",
    "  return a + b;",
    "}",
    "```",
    "",
    "Now, let's run the test again to prove it passes.",
  ].join("\n");

  it("flags a proposed fix that was never applied", () => {
    expect(describesUnappliedChange({ replyText: realCase, toolNames: ["read", "exec"] })).toBe(
      true,
    );
  });

  it("stays quiet when the turn actually edited a file", () => {
    expect(describesUnappliedChange({ replyText: realCase, toolNames: ["read", "edit"] })).toBe(
      false,
    );
  });

  it("stays quiet when the turn wrote a file", () => {
    expect(describesUnappliedChange({ replyText: realCase, toolNames: ["write"] })).toBe(false);
  });

  it("does not flag an explanation that only shows code", () => {
    const explanation = [
      "The bug is the minus sign. A correct implementation looks like this:",
      "",
      "```js",
      "export const add = (a, b) => a + b;",
      "```",
      "",
      "That is why the assertion fails.",
    ].join("\n");
    expect(describesUnappliedChange({ replyText: explanation, toolNames: [] })).toBe(false);
  });

  it("does not flag prose that promises action but proposes no code", () => {
    expect(
      describesUnappliedChange({
        replyText: "I'll update the config once you confirm the environment.",
        toolNames: [],
      }),
    ).toBe(false);
  });

  it("handles empty and missing replies", () => {
    expect(describesUnappliedChange({ replyText: "", toolNames: [] })).toBe(false);
    expect(describesUnappliedChange({ replyText: undefined, toolNames: [] })).toBe(false);
  });
});

describe("turnWroteFiles", () => {
  it("recognizes file writes as the change being applied", () => {
    expect(turnWroteFiles(["write"])).toBe(true);
    expect(turnWroteFiles(["edit"])).toBe(true);
    expect(turnWroteFiles(["read", "multi_edit"])).toBe(true);
  });

  it("does not count exec or reads as applying a change", () => {
    expect(turnWroteFiles(["read", "exec", "web_search"])).toBe(false);
    expect(turnWroteFiles([])).toBe(false);
  });
});
