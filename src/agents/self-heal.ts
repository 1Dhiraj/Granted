/**
 * Turn-end self-heal gate.
 *
 * The sibling of the verification gate. Verification catches "claimed done
 * without looking"; this catches the other half — an action that actually
 * failed and was then abandoned, with the turn ending as if nothing were
 * wrong.
 *
 * A human automator reads the error, adjusts, and tries again before giving
 * up. This returns one bounded instruction to do exactly that, or null when
 * the failure was already recovered from or already reported honestly with a
 * real blocker.
 *
 * Policy only: it runs nothing itself and never edits the model's words.
 */

import { isMutatingCall, type TurnToolCall } from "./verify-on-stop.js";

const DEFAULT_MAX_HEAL_ATTEMPTS = 2;

/**
 * Failures no amount of retrying will fix, because something outside the
 * agent has to change: a human gate, a missing credential, or an explicit
 * refusal. Nudging a retry here wastes tokens and annoys the user.
 */
const UNRECOVERABLE_ERROR_RE =
  /\b(?:2fa|two-factor|captcha|permission denied|access denied|unauthorized|forbidden|401|403|payment required|402|quota|rate limit|spend limit|requires approval|approval required|not authorized|no api key)\b/i;

/** A blocker the model has already surfaced to the user in its own words. */
const REPORTED_BLOCKER_RE =
  /\b(?:permission|denied|unauthorized|forbidden|2fa|captcha|credential|api key|quota|rate limit|approval|blocked|need(?:s)? (?:you|your)|cannot proceed|can'?t proceed)\b/i;

/** Language showing the reply already owns the failure rather than hiding it. */
const ADMITS_FAILURE_RE =
  /\b(?:fail(?:ed|ure|s)?|error|unable|couldn'?t|could not|cannot|can'?t|did ?n'?t work|was ?n'?t able|no luck|blocked)\b/i;

export type SelfHealParams = {
  /** Tool calls made during this turn, in order. */
  toolCalls: TurnToolCall[];
  /** The assistant's user-facing reply for the turn. */
  replyText: string;
  /** How many self-heal follow-ups this turn has already spent. */
  attempts?: number;
  /** Upper bound, so a doomed action is not retried forever. */
  maxAttempts?: number;
};

function callKey(call: TurnToolCall): string {
  return `${(call.name ?? "").toLowerCase()}::${(call.action ?? "").toLowerCase()}`;
}

/** Whether retrying this error could plausibly change the outcome. */
export function isRecoverableFailure(error: string | undefined): boolean {
  return !UNRECOVERABLE_ERROR_RE.test(error ?? "");
}

/**
 * Return a follow-up instruction when a state-changing action failed and the
 * turn ended without recovering from it, or null when no nudge is due.
 */
export function buildSelfHealNudge(params: SelfHealParams): string | null {
  const maxAttempts = params.maxAttempts ?? DEFAULT_MAX_HEAL_ATTEMPTS;
  if ((params.attempts ?? 0) >= maxAttempts) {
    return null;
  }

  const calls = params.toolCalls ?? [];
  let failureIndex = -1;
  for (let i = calls.length - 1; i >= 0; i -= 1) {
    const call = calls[i];
    // isMutatingCall() reports false for failed calls by design, so ask
    // whether this *would* have been a state change had it succeeded.
    if (call?.isError && isMutatingCall({ ...call, isError: false })) {
      failureIndex = i;
      break;
    }
  }
  if (failureIndex === -1) {
    return null;
  }

  const failed = calls[failureIndex] as TurnToolCall;

  // Already recovered: the same action succeeded later in the turn.
  const recovered = calls
    .slice(failureIndex + 1)
    .some((call) => call && !call.isError && callKey(call) === callKey(failed));
  if (recovered) {
    return null;
  }

  // Retrying cannot help, and the model already told the user why.
  if (!isRecoverableFailure(failed.error)) {
    const reported = ADMITS_FAILURE_RE.test(params.replyText ?? "")
      && REPORTED_BLOCKER_RE.test(params.replyText ?? "");
    if (reported) {
      return null;
    }
  }

  const what = failed.action
    ? `${(failed.name ?? "a tool").toLowerCase()} (${failed.action.toLowerCase()})`
    : (failed.name ?? "a tool").toLowerCase();
  const because = failed.error ? `\n\nThe error was: ${failed.error}` : "";

  return (
    `[System: ${what} failed during this turn and the task was left unfinished.` +
    `${because}\n\n` +
    `Read that error and treat it as information, not a dead end: work out why it failed, ` +
    `change your approach, and try once more — a different path, corrected arguments, or a ` +
    `fresh look at the current state first. If it fails again for the same reason, or the ` +
    `blocker genuinely needs a human (a login, a permission, a payment), stop and say plainly ` +
    `what is blocked and what you need. Do not report the task as done.]`
  );
}

export { DEFAULT_MAX_HEAL_ATTEMPTS };
