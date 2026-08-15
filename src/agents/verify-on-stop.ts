/**
 * Turn-end verification gate.
 *
 * When a turn changed real state — wrote a file, launched or drove an app,
 * submitted a form — and the reply claims it worked, but nothing in that turn
 * ever read the state back, this returns one bounded follow-up: go look, then
 * report what you actually observed.
 *
 * Policy only. It runs no checks itself and never rewrites the model's words;
 * the caller decides whether to spend a follow-up turn on it.
 *
 * The evidence-gate shape is adapted from Hermes Agent's verification stop
 * (NousResearch/hermes-agent, MIT), generalized from "edited code" to any
 * state-changing action so it covers desktop, browser, and messaging work too.
 */

const DEFAULT_MAX_VERIFY_ATTEMPTS = 2;

/** Tools whose successful use changes real state the agent could later inspect. */
const MUTATING_TOOL_NAMES = new Set([
  "write",
  "edit",
  "apply_patch",
  "exec",
  "bash",
  "process",
  "cron",
  "message",
  "sessions_send",
  "canvas",
  "nodes",
]);

/** Tools whose use observes real state (the evidence side of the ledger). */
const VERIFYING_TOOL_NAMES = new Set(["read", "sessions_history", "sessions_list"]);

/** Desktop/browser sub-actions that change state vs. observe it. */
const MUTATING_ACTIONS = new Set([
  "act",
  "launch",
  "window",
  "click",
  "type",
  "paste",
  "key",
  "scroll",
  "drag",
  "invoke",
  "toggle",
  "select",
  "navigate",
  "fill",
  "submit",
  "upload",
]);
const VERIFYING_ACTIONS = new Set([
  "read",
  "snapshot",
  "screenshot",
  "find",
  "apps",
  "text",
  "title",
  "content",
  "evaluate",
]);

/**
 * Shell commands that only inspect state. `exec` is the agent's universal
 * effector, so treating every exec as a mutation would demand verification of
 * pure lookups; treating none as a mutation would miss real changes.
 */
const READ_ONLY_COMMAND_RE =
  /^\s*(?:sudo\s+)?(?:cat|type|ls|dir|pwd|echo|find|grep|select-string|head|tail|wc|stat|get-content|get-childitem|get-process|get-psdrive|get-item|test-path|which|where|whoami|date|df|du)\b/i;

/**
 * Language that asserts the work is finished. Deliberately narrow: it must
 * catch "it's done / I created it / the result is 4" without firing on hedged
 * or descriptive text ("this will create...", "you can run...").
 */
const SUCCESS_CLAIM_RE = new RegExp(
  [
    "\\b(?:has|have|had)\\s+been\\s+(?:created|saved|written|opened|launched|sent|updated|deleted|renamed|installed|added|scheduled|completed|performed|executed)\\b",
    "\\bi\\s+(?:have\\s+)?(?:created|saved|wrote|written|opened|launched|sent|updated|deleted|renamed|added|scheduled|completed|performed|executed|ran)\\b",
    "\\b(?:successfully|now)\\s+(?:created|saved|written|opened|launched|sent|updated|deleted|renamed|added|scheduled|completed|performed|executed)\\b",
    "\\bthe\\s+(?:result|answer|total|output)\\s+is\\b",
    "\\bit(?:'s| is)\\s+done\\b",
    "\\ball\\s+(?:set|done)\\b",
    "\\b(?:task|job)\\s+(?:is\\s+)?complete(?:d)?\\b",
  ].join("|"),
  "i",
);

/** Hedges that mean the model is describing an intent, not asserting completion. */
const HEDGE_RE =
  /\b(?:will|would|should|can|could|try|attempt|going to|about to|couldn'?t|could not|cannot|can'?t|unable|fail(?:ed|s)?|error|not able|did ?n'?t|was ?n'?t)\b/i;

export type TurnToolCall = {
  /** Canonical tool name, e.g. "write", "exec", "desktop", "browser". */
  name: string;
  /** Sub-action when the tool has one (desktop act kind, browser action, ...). */
  action?: string;
  /** Primary command/argument, used to tell read-only shell calls from mutations. */
  command?: string;
  /** A failed call changed nothing, so it needs a retry rather than verification. */
  isError?: boolean;
  /** Failure text, so the self-heal gate can tell a fixable error from a hard blocker. */
  error?: string;
  /**
   * Caller's own mutation verdict (Granted classifies this per call from the
   * real arguments). It is argument-aware, so it wins over the name/action
   * heuristics below when present.
   */
  mutating?: boolean;
};

export type VerifyOnStopParams = {
  /** Tool calls made during this turn, in order. */
  toolCalls: TurnToolCall[];
  /** The assistant's user-facing reply for the turn. */
  replyText: string;
  /** How many verification follow-ups this turn has already spent. */
  attempts?: number;
  /** Upper bound on follow-ups, so a stubborn model cannot loop forever. */
  maxAttempts?: number;
};

function normalize(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/** Whether a call changed state the agent could later read back. */
export function isMutatingCall(call: TurnToolCall): boolean {
  if (call.isError) {
    return false;
  }
  if (typeof call.mutating === "boolean") {
    return call.mutating;
  }
  const name = normalize(call.name);
  const action = normalize(call.action);
  if (action && VERIFYING_ACTIONS.has(action)) {
    return false;
  }
  if (action && MUTATING_ACTIONS.has(action)) {
    return true;
  }
  if ((name === "exec" || name === "bash") && READ_ONLY_COMMAND_RE.test(call.command ?? "")) {
    return false;
  }
  return MUTATING_TOOL_NAMES.has(name);
}

/** Whether a call observed real state, and so counts as verification evidence. */
export function isVerifyingCall(call: TurnToolCall): boolean {
  if (call.isError) {
    return false;
  }
  const name = normalize(call.name);
  const action = normalize(call.action);
  if (action && VERIFYING_ACTIONS.has(action)) {
    return true;
  }
  if (VERIFYING_TOOL_NAMES.has(name)) {
    return true;
  }
  return (name === "exec" || name === "bash") && READ_ONLY_COMMAND_RE.test(call.command ?? "");
}

/** Whether the reply asserts the work finished, rather than describing or hedging. */
export function claimsSuccess(replyText: string): boolean {
  const text = (replyText ?? "").trim();
  if (!text) {
    return false;
  }
  if (!SUCCESS_CLAIM_RE.test(text)) {
    return false;
  }
  // An acknowledged failure or a stated intention is not an unverified claim.
  return !HEDGE_RE.test(text);
}

function describeAction(call: TurnToolCall): string {
  const name = normalize(call.name) || "a tool";
  const action = normalize(call.action);
  return action ? `${name} (${action})` : name;
}

/**
 * Return a follow-up instruction when this turn claimed success after changing
 * state without ever reading that state back, or null when no nudge is due.
 */
export function buildVerifyOnStopNudge(params: VerifyOnStopParams): string | null {
  const maxAttempts = params.maxAttempts ?? DEFAULT_MAX_VERIFY_ATTEMPTS;
  if ((params.attempts ?? 0) >= maxAttempts) {
    return null;
  }
  if (!claimsSuccess(params.replyText)) {
    return null;
  }

  const calls = params.toolCalls ?? [];
  let lastMutationIndex = -1;
  for (let i = calls.length - 1; i >= 0; i -= 1) {
    const call = calls[i];
    if (call && isMutatingCall(call)) {
      lastMutationIndex = i;
      break;
    }
  }
  if (lastMutationIndex === -1) {
    // Nothing was changed. Either the turn was pure conversation (fine) or the
    // model claimed an action it never performed — the no-tool-call case, which
    // the reply-payload guard already surfaces to the user.
    return null;
  }

  // Evidence only counts when it came after the change it is meant to confirm.
  const verifiedAfter = calls
    .slice(lastMutationIndex + 1)
    .some((call) => call && isVerifyingCall(call));
  if (verifiedAfter) {
    return null;
  }

  const mutation = describeAction(calls[lastMutationIndex] as TurnToolCall);
  return (
    `[System: You reported this as done, but nothing in this turn read the result back. ` +
    `The last change was ${mutation}, and no check followed it.\n\n` +
    `Verify it now against the real state — read the file back, take a fresh snapshot or ` +
    `screenshot, re-run the query, or check the list — then report exactly what you observed. ` +
    `If the check shows it did not work, say so and fix it. If you cannot verify it, say ` +
    `plainly that it is unverified and why. Do not repeat the claim without evidence.]`
  );
}

/**
 * Short user-facing note for the same condition, for surfaces that cannot spend
 * another model turn. Says only what is true — the claim was not checked — and
 * never contradicts a result that may well be correct.
 */
export function buildUnverifiedClaimWarning(params: {
  toolCalls: TurnToolCall[];
  replyText: string;
}): string | null {
  const due = buildVerifyOnStopNudge({
    toolCalls: params.toolCalls,
    replyText: params.replyText,
  });
  return due ? "⚠️ Unverified — the agent did not check this result before reporting it." : null;
}

export { DEFAULT_MAX_VERIFY_ATTEMPTS };
