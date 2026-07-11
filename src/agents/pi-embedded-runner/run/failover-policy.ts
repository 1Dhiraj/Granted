import type { FailoverReason } from "../../pi-embedded-helpers.js";

export type RunFailoverDecisionAction =
  | "continue_normal"
  | "rotate_profile"
  | "fallback_model"
  | "surface_error"
  | "return_error_payload";

export type RunFailoverDecision =
  | {
      action: "continue_normal";
    }
  | {
      action: "rotate_profile" | "surface_error";
      reason: FailoverReason | null;
    }
  | {
      action: "fallback_model";
      reason: FailoverReason;
    }
  | {
      action: "return_error_payload";
    };

export type RetryLimitFailoverDecision = Extract<
  RunFailoverDecision,
  { action: "fallback_model" | "return_error_payload" }
>;

export type PromptFailoverDecision = Extract<
  RunFailoverDecision,
  { action: "rotate_profile" | "fallback_model" | "surface_error" }
>;

export type AssistantFailoverDecision = Extract<
  RunFailoverDecision,
  { action: "continue_normal" | "rotate_profile" | "fallback_model" | "surface_error" }
>;

type RetryLimitDecisionParams = {
  stage: "retry_limit";
  fallbackConfigured: boolean;
  failoverReason: FailoverReason | null;
  /** auth.cooldowns.fallbackOnRateLimit — when false, 429s never switch models. */
  rateLimitModelFallback?: boolean;
};

type PromptDecisionParams = {
  stage: "prompt";
  aborted: boolean;
  fallbackConfigured: boolean;
  failoverFailure: boolean;
  failoverReason: FailoverReason | null;
  profileRotated: boolean;
  /** auth.cooldowns.fallbackOnRateLimit — when false, 429s never switch models. */
  rateLimitModelFallback?: boolean;
};

type AssistantDecisionParams = {
  stage: "assistant";
  aborted: boolean;
  fallbackConfigured: boolean;
  failoverFailure: boolean;
  failoverReason: FailoverReason | null;
  timedOut: boolean;
  timedOutDuringCompaction: boolean;
  profileRotated: boolean;
  /** auth.cooldowns.fallbackOnRateLimit — when false, 429s never switch models. */
  rateLimitModelFallback?: boolean;
};

export type RunFailoverDecisionParams =
  | RetryLimitDecisionParams
  | PromptDecisionParams
  | AssistantDecisionParams;

function shouldEscalateRetryLimit(
  reason: FailoverReason | null,
  rateLimitModelFallback: boolean,
): boolean {
  if (reason === "rate_limit" && !rateLimitModelFallback) {
    return false;
  }
  return Boolean(
    reason &&
    reason !== "timeout" &&
    reason !== "model_not_found" &&
    reason !== "format" &&
    reason !== "session_expired",
  );
}

// Rate limits rotate to the next auth profile first — another key on the
// SAME model gets fresh quota — so rotation applies regardless of the
// fallbackOnRateLimit toggle; only the model switch is gated by it.
function shouldRotatePrompt(params: PromptDecisionParams): boolean {
  return params.failoverReason === "rate_limit" && !params.aborted;
}

function shouldRotateAssistant(params: AssistantDecisionParams): boolean {
  return params.failoverReason === "rate_limit" && !params.aborted;
}

export function mergeRetryFailoverReason(params: {
  previous: FailoverReason | null;
  failoverReason: FailoverReason | null;
  timedOut?: boolean;
}): FailoverReason | null {
  return params.failoverReason ?? (params.timedOut ? "timeout" : null) ?? params.previous;
}

export function resolveRunFailoverDecision(
  params: RetryLimitDecisionParams,
): RetryLimitFailoverDecision;
export function resolveRunFailoverDecision(params: PromptDecisionParams): PromptFailoverDecision;
export function resolveRunFailoverDecision(
  params: AssistantDecisionParams,
): AssistantFailoverDecision;
export function resolveRunFailoverDecision(params: RunFailoverDecisionParams): RunFailoverDecision {
  const rateLimitModelFallback = params.rateLimitModelFallback ?? true;
  if (params.stage === "retry_limit") {
    if (
      params.fallbackConfigured &&
      shouldEscalateRetryLimit(params.failoverReason, rateLimitModelFallback)
    ) {
      const fallbackReason = params.failoverReason ?? "unknown";
      return {
        action: "fallback_model",
        reason: fallbackReason,
      };
    }
    return {
      action: "return_error_payload",
    };
  }

  if (params.stage === "prompt") {
    if (!params.profileRotated && shouldRotatePrompt(params)) {
      return {
        action: "rotate_profile",
        reason: params.failoverReason,
      };
    }
    if (params.fallbackConfigured && params.failoverFailure) {
      if (params.failoverReason === "rate_limit" && !rateLimitModelFallback) {
        return {
          action: "surface_error",
          reason: params.failoverReason,
        };
      }
      return {
        action: "fallback_model",
        reason: params.failoverReason ?? "unknown",
      };
    }
    return {
      action: "surface_error",
      reason: params.failoverReason,
    };
  }

  // Rate-limited streams used to spin on the same model until the retry
  // limit (32+ attempts). Rotate to the next auth profile first; once
  // rotation is exhausted, escalate to the model chain (if permitted).
  const assistantShouldRotate = shouldRotateAssistant(params);
  if (!params.profileRotated && assistantShouldRotate) {
    return {
      action: "rotate_profile",
      reason: params.failoverReason,
    };
  }
  if (assistantShouldRotate && params.fallbackConfigured) {
    if (params.failoverReason === "rate_limit" && !rateLimitModelFallback) {
      // User opted out of switching models on rate limits: keep retrying
      // the same model with backoff.
      return {
        action: "continue_normal",
      };
    }
    return {
      action: "fallback_model",
      reason: params.timedOut ? "timeout" : (params.failoverReason ?? "unknown"),
    };
  }
  if (assistantShouldRotate && !params.fallbackConfigured) {
    // No fallback chain to advance to: keep the pre-existing behavior of
    // retrying the same model with backoff.
    return {
      action: "continue_normal",
    };
  }
  return {
    action: "continue_normal",
  };
}
