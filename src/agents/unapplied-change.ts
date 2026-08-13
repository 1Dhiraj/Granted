import { normalizeLowercaseStringOrEmpty } from "../shared/string-coerce.js";

/**
 * Detects the "described the fix but never made it" turn.
 *
 * Observed case: asked to fix a failing test, a capable model diagnosed the bug
 * exactly right ("change `add` to return a + b instead of a - b"), printed the
 * corrected code, said "now let's run the test again to prove it passes" — and
 * ended the turn without calling a single mutating tool. The file was unchanged.
 * Nothing lied, so the false-success guard never fired; the work simply did not
 * happen, silently.
 *
 * Deliberately conservative, because a warning on a genuine "show me how to fix
 * this" answer would be noise. All three must hold:
 *   1. no mutating tool ran in the turn (a write/edit means it did act),
 *   2. the reply contains a fenced code block (it produced a concrete change),
 *   3. the reply promises to apply or run it, in the first person.
 * Explanations that merely show code do not match (3), so they stay quiet.
 */

/** "here's the corrected code, now let's run it" — an action about to happen. */
const APPLY_INTENT_RE =
  /\b(?:i(?:'|’)?ll|i will|let(?:'|’)?s|we(?:'|’)?ll|we will|now (?:let(?:'|’)?s|i(?:'|’)?ll|run|update))\s+(?:go ahead and\s+)?(?:apply|update|change|replace|fix|edit|write|save|run|re-?run|test)\b/i;

/** A fenced block is how a proposed file change actually shows up. */
const CODE_FENCE_RE = /```/;

export type UnappliedChangeInput = {
  /** Assistant text for the finished turn. */
  replyText: string | undefined;
  /** Every tool called during the turn, in order. */
  toolNames: readonly string[];
};

/**
 * Only tools that write file content count as "the change was applied".
 * Deliberately narrower than the general mutating-tool check, which treats
 * `exec` as mutating — the described-but-not-applied turn usually DOES run
 * `exec` to reproduce the failure, so counting it would mask exactly the case
 * this detects. A fix applied through a shell redirect is the rare miss, and a
 * spurious "verify it yourself" note is a cheaper mistake than silence.
 */
const FILE_WRITING_TOOLS = new Set([
  "write",
  "edit",
  "multi_edit",
  "notebook_edit",
  "apply_patch",
  "str_replace",
]);

export function turnWroteFiles(toolNames: readonly string[]): boolean {
  return toolNames.some((name) =>
    FILE_WRITING_TOOLS.has(normalizeLowercaseStringOrEmpty(name) ?? ""),
  );
}

export function describesUnappliedChange(input: UnappliedChangeInput): boolean {
  const text = input.replyText ?? "";
  if (!normalizeLowercaseStringOrEmpty(text)) {
    return false;
  }
  // Acting beats talking: if it wrote or edited a file, this is not our case.
  if (turnWroteFiles(input.toolNames)) {
    return false;
  }
  if (!CODE_FENCE_RE.test(text)) {
    return false;
  }
  return APPLY_INTENT_RE.test(text);
}

/** Warning shown to the user when a turn only described the change. */
export const UNAPPLIED_CHANGE_WARNING =
  "⚠️ This describes a change but no file was modified — nothing was actually applied. Ask it to make the change, or verify the file yourself.";
