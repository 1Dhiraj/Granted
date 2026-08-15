import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import {
  applyLocalSetupWorkspaceConfig,
  ONBOARDING_DEFAULT_DM_SCOPE,
  ONBOARDING_DEFAULT_SPEND_LIMIT_USD,
  ONBOARDING_DEFAULT_TOOLS_PROFILE,
} from "./onboard-config.js";

describe("applyLocalSetupWorkspaceConfig", () => {
  it("defaults local setup tool profile to coding", () => {
    expect(ONBOARDING_DEFAULT_TOOLS_PROFILE).toBe("coding");
  });

  it("sets secure dmScope default when unset", () => {
    const baseConfig: OpenClawConfig = {};
    const result = applyLocalSetupWorkspaceConfig(baseConfig, "/tmp/workspace");

    expect(result.session?.dmScope).toBe(ONBOARDING_DEFAULT_DM_SCOPE);
    expect(result.gateway?.mode).toBe("local");
    expect(result.agents?.defaults?.workspace).toBe("/tmp/workspace");
    expect(result.tools?.profile).toBe(ONBOARDING_DEFAULT_TOOLS_PROFILE);
  });

  // A fresh install runs heartbeats, cron jobs and retries against a paid key
  // with nobody watching. Shipping without a ceiling means the first sign of a
  // stuck job is the bill.
  it("gives a new install a spend ceiling", () => {
    const result = applyLocalSetupWorkspaceConfig({}, "/tmp/workspace");
    expect(result.agents?.defaults?.spendLimitUsd).toBe(ONBOARDING_DEFAULT_SPEND_LIMIT_USD);
    expect(ONBOARDING_DEFAULT_SPEND_LIMIT_USD).toBeGreaterThan(0);
  });

  it("never overrides a spend limit the user already chose", () => {
    const result = applyLocalSetupWorkspaceConfig(
      { agents: { defaults: { spendLimitUsd: 250 } } },
      "/tmp/workspace",
    );
    expect(result.agents?.defaults?.spendLimitUsd).toBe(250);
  });

  it("respects a deliberate 0, which means no ceiling", () => {
    const result = applyLocalSetupWorkspaceConfig(
      { agents: { defaults: { spendLimitUsd: 0 } } },
      "/tmp/workspace",
    );
    expect(result.agents?.defaults?.spendLimitUsd).toBe(0);
  });

  it("preserves existing dmScope when already configured", () => {
    const baseConfig: OpenClawConfig = {
      session: {
        dmScope: "main",
      },
    };
    const result = applyLocalSetupWorkspaceConfig(baseConfig, "/tmp/workspace");

    expect(result.session?.dmScope).toBe("main");
  });

  it("preserves explicit non-main dmScope values", () => {
    const baseConfig: OpenClawConfig = {
      session: {
        dmScope: "per-account-channel-peer",
      },
    };
    const result = applyLocalSetupWorkspaceConfig(baseConfig, "/tmp/workspace");

    expect(result.session?.dmScope).toBe("per-account-channel-peer");
  });

  it("preserves an explicit tools.profile when already configured", () => {
    const baseConfig: OpenClawConfig = {
      tools: {
        profile: "full",
      },
    };
    const result = applyLocalSetupWorkspaceConfig(baseConfig, "/tmp/workspace");

    expect(result.tools?.profile).toBe("full");
  });
});
