import { describe, expect, it } from "vitest";
import { FailoverError, resolveFailoverReasonFromError } from "../../failover-error.js";
import { resolveRunFailoverDecision } from "./failover-policy.js";

// Regression: a provider-scoped spend limit blocks ONE provider, so it must walk
// the configured model chain like any other billing failure. It used to throw a
// plain Error, which carries no failover reason — the fallback walker then read
// the attempt as completed, logged "candidate_succeeded", and stopped with
// next=none. Configured backstops (free local/secondary models) never ran.
describe("provider spend limit failover", () => {
  const spendLimitError = () =>
    new FailoverError(
      'Provider spend limit reached for "together": $2.5219 spent of $2.50 limit (agents.defaults.spendLimitUsdByProvider). Calls to this provider are blocked — raise or remove its limit in openclaw.json, or switch models to another provider.',
      { reason: "billing", provider: "together", model: "meta-llama/Llama-3.3-70B-Instruct-Turbo" },
    );

  it("classifies the provider spend-limit block as a billing failover reason", () => {
    expect(resolveFailoverReasonFromError(spendLimitError())).toBe("billing");
  });

  it("advances to the next model in the chain instead of halting", () => {
    expect(
      resolveRunFailoverDecision({
        stage: "assistant",
        aborted: false,
        fallbackConfigured: true,
        failoverFailure: true,
        failoverReason: resolveFailoverReasonFromError(spendLimitError()),
        timedOut: false,
        timedOutDuringCompaction: false,
        profileRotated: true,
      }),
    ).toEqual({ action: "fallback_model", reason: "billing" });
  });

  it("still surfaces the error when no fallback chain is configured", () => {
    const decision = resolveRunFailoverDecision({
      stage: "assistant",
      aborted: false,
      fallbackConfigured: false,
      failoverFailure: true,
      failoverReason: resolveFailoverReasonFromError(spendLimitError()),
      timedOut: false,
      timedOutDuringCompaction: false,
      profileRotated: true,
    });
    expect(decision.action).not.toBe("fallback_model");
  });
});
