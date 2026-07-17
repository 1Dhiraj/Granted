import { describe, expect, it } from "vitest";
import { mergeRetryFailoverReason, resolveRunFailoverDecision } from "./failover-policy.js";

describe("resolveRunFailoverDecision", () => {
  it("escalates retry-limit exhaustion for replay-safe failover reasons", () => {
    expect(
      resolveRunFailoverDecision({
        stage: "retry_limit",
        fallbackConfigured: true,
        failoverReason: "rate_limit",
      }),
    ).toEqual({
      action: "fallback_model",
      reason: "rate_limit",
    });
  });

  it("keeps retry-limit as a local error for non-escalating reasons", () => {
    expect(
      resolveRunFailoverDecision({
        stage: "retry_limit",
        fallbackConfigured: true,
        failoverReason: "timeout",
      }),
    ).toEqual({
      action: "return_error_payload",
    });
  });

  it("prefers prompt-side profile rotation before fallback", () => {
    expect(
      resolveRunFailoverDecision({
        stage: "prompt",
        aborted: false,
        fallbackConfigured: true,
        failoverFailure: true,
        failoverReason: "rate_limit",
        profileRotated: false,
      }),
    ).toEqual({
      action: "rotate_profile",
      reason: "rate_limit",
    });
  });

  it("falls back after prompt rotation is exhausted", () => {
    expect(
      resolveRunFailoverDecision({
        stage: "prompt",
        aborted: false,
        fallbackConfigured: true,
        failoverFailure: true,
        failoverReason: "rate_limit",
        profileRotated: true,
      }),
    ).toEqual({
      action: "fallback_model",
      reason: "rate_limit",
    });
  });

  it("treats classified assistant-side 429s as rotation candidates even without error stopReason", () => {
    expect(
      resolveRunFailoverDecision({
        stage: "assistant",
        aborted: false,
        fallbackConfigured: true,
        failoverFailure: false,
        failoverReason: "rate_limit",
        timedOut: false,
        timedOutDuringCompaction: false,
        profileRotated: false,
      }),
    ).toEqual({
      action: "rotate_profile",
      reason: "rate_limit",
    });
  });

  it("falls back after assistant rotation is exhausted", () => {
    expect(
      resolveRunFailoverDecision({
        stage: "assistant",
        aborted: false,
        fallbackConfigured: true,
        failoverFailure: false,
        failoverReason: "rate_limit",
        timedOut: false,
        timedOutDuringCompaction: false,
        profileRotated: true,
      }),
    ).toEqual({
      action: "fallback_model",
      reason: "rate_limit",
    });
  });

  it("keeps retrying the same model when fallbackOnRateLimit is disabled (assistant)", () => {
    expect(
      resolveRunFailoverDecision({
        stage: "assistant",
        rateLimitModelFallback: false,
        aborted: false,
        fallbackConfigured: true,
        failoverFailure: false,
        failoverReason: "rate_limit",
        timedOut: false,
        timedOutDuringCompaction: false,
        profileRotated: true,
      }),
    ).toEqual({
      action: "continue_normal",
    });
  });

  it("still rotates profiles on 429 when fallbackOnRateLimit is disabled", () => {
    expect(
      resolveRunFailoverDecision({
        stage: "assistant",
        rateLimitModelFallback: false,
        aborted: false,
        fallbackConfigured: true,
        failoverFailure: false,
        failoverReason: "rate_limit",
        timedOut: false,
        timedOutDuringCompaction: false,
        profileRotated: false,
      }),
    ).toEqual({
      action: "rotate_profile",
      reason: "rate_limit",
    });
  });

  it("surfaces prompt-side 429s instead of switching models when disabled", () => {
    expect(
      resolveRunFailoverDecision({
        stage: "prompt",
        rateLimitModelFallback: false,
        aborted: false,
        fallbackConfigured: true,
        failoverFailure: true,
        failoverReason: "rate_limit",
        profileRotated: true,
      }),
    ).toEqual({
      action: "surface_error",
      reason: "rate_limit",
    });
  });

  it("does not escalate retry-limit exhaustion for 429s when disabled", () => {
    expect(
      resolveRunFailoverDecision({
        stage: "retry_limit",
        rateLimitModelFallback: false,
        fallbackConfigured: true,
        failoverReason: "rate_limit",
      }),
    ).toEqual({
      action: "return_error_payload",
    });
  });

  it("does nothing for assistant turns without failover signals", () => {
    expect(
      resolveRunFailoverDecision({
        stage: "assistant",
        aborted: false,
        fallbackConfigured: true,
        failoverFailure: false,
        failoverReason: null,
        timedOut: false,
        timedOutDuringCompaction: false,
        profileRotated: false,
      }),
    ).toEqual({
      action: "continue_normal",
    });
  });

  it("advances the model chain on an assistant auth failure (dead key mid-chain)", () => {
    // Regression: a bad key (401) on a fallback candidate used to surface here
    // via continue_normal, stopping the chain before later fallbacks (e.g. a
    // local model) were ever tried.
    expect(
      resolveRunFailoverDecision({
        stage: "assistant",
        aborted: false,
        fallbackConfigured: true,
        failoverFailure: true,
        failoverReason: "auth",
        timedOut: false,
        timedOutDuringCompaction: false,
        profileRotated: true,
      }),
    ).toEqual({
      action: "fallback_model",
      reason: "auth",
    });
  });

  it("advances the model chain on an assistant billing failure", () => {
    expect(
      resolveRunFailoverDecision({
        stage: "assistant",
        aborted: false,
        fallbackConfigured: true,
        failoverFailure: true,
        failoverReason: "billing",
        timedOut: false,
        timedOutDuringCompaction: false,
        profileRotated: true,
      }),
    ).toEqual({
      action: "fallback_model",
      reason: "billing",
    });
  });

  it("does not advance on a non-escalating assistant failure (model_not_found)", () => {
    expect(
      resolveRunFailoverDecision({
        stage: "assistant",
        aborted: false,
        fallbackConfigured: true,
        failoverFailure: true,
        failoverReason: "model_not_found",
        timedOut: false,
        timedOutDuringCompaction: false,
        profileRotated: true,
      }),
    ).toEqual({
      action: "continue_normal",
    });
  });

  it("does not advance an auth failure when no fallback chain is configured", () => {
    expect(
      resolveRunFailoverDecision({
        stage: "assistant",
        aborted: false,
        fallbackConfigured: false,
        failoverFailure: true,
        failoverReason: "auth",
        timedOut: false,
        timedOutDuringCompaction: false,
        profileRotated: true,
      }),
    ).toEqual({
      action: "continue_normal",
    });
  });
});

describe("mergeRetryFailoverReason", () => {
  it("preserves the previous classified reason when the current one is null", () => {
    expect(
      mergeRetryFailoverReason({
        previous: "rate_limit",
        failoverReason: null,
      }),
    ).toBe("rate_limit");
  });

  it("records timeout when no classified reason is present", () => {
    expect(
      mergeRetryFailoverReason({
        previous: null,
        failoverReason: null,
        timedOut: true,
      }),
    ).toBe("timeout");
  });
});
