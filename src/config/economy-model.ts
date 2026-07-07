import type { OpenClawConfig } from "./config.js";

/**
 * Cheap model configured for background/low-stakes roles (heartbeat, sub-agents,
 * compaction). Keeps routine work off the expensive primary key when the user
 * only has one provider or wants to protect a premium model budget.
 */
export function resolveEconomyModelRef(cfg?: OpenClawConfig): string | undefined {
  const raw = cfg?.agents?.defaults?.economyModel;
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed.length > 0 ? trimmed : undefined;
}
