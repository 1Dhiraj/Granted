import type { OpenClawConfig } from "../config/config.js";
import type { DmScope } from "../config/types.base.js";
import type { ToolProfileId } from "../config/types.tools.js";

export const ONBOARDING_DEFAULT_DM_SCOPE: DmScope = "per-channel-peer";
export const ONBOARDING_DEFAULT_TOOLS_PROFILE: ToolProfileId = "coding";

/**
 * A new install runs unattended — heartbeats, cron jobs, retries — against a key
 * the user pays for. With no cap, a stuck job or a rate-limit cascade into a paid
 * fallback bills them while nobody is watching, and the first they learn of it is
 * the invoice. Observed on a real machine: an orphaned hourly job billed for weeks
 * unnoticed. Ship a ceiling by default; a user who wants more raises it knowingly.
 *
 * Chosen to be generous for real use and still bounded: a runaway costs single
 * digits, not a rent payment.
 */
export const ONBOARDING_DEFAULT_SPEND_LIMIT_USD = 10;

export function applyLocalSetupWorkspaceConfig(
  baseConfig: OpenClawConfig,
  workspaceDir: string,
): OpenClawConfig {
  return {
    ...baseConfig,
    agents: {
      ...baseConfig.agents,
      defaults: {
        ...baseConfig.agents?.defaults,
        workspace: workspaceDir,
        // Only set when absent, so an existing choice (including a deliberate 0
        // meaning "no ceiling") is never overwritten by re-running setup.
        spendLimitUsd:
          baseConfig.agents?.defaults?.spendLimitUsd ?? ONBOARDING_DEFAULT_SPEND_LIMIT_USD,
      },
    },
    gateway: {
      ...baseConfig.gateway,
      mode: "local",
    },
    session: {
      ...baseConfig.session,
      dmScope: baseConfig.session?.dmScope ?? ONBOARDING_DEFAULT_DM_SCOPE,
    },
    tools: {
      ...baseConfig.tools,
      profile: baseConfig.tools?.profile ?? ONBOARDING_DEFAULT_TOOLS_PROFILE,
    },
  };
}
