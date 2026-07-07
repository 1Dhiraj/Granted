import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { resolveSubagentSpawnModelSelection } from "./model-selection.js";

describe("resolveSubagentSpawnModelSelection economy fallback", () => {
  it("uses economyModel when no subagent model is configured", () => {
    const cfg = {
      agents: {
        defaults: {
          model: { primary: "anthropic/claude-opus-4-8" },
          economyModel: "google/gemini-3.5-flash",
        },
      },
    } as unknown as OpenClawConfig;
    expect(resolveSubagentSpawnModelSelection({ cfg, agentId: "main" })).toBe(
      "google/gemini-3.5-flash",
    );
  });

  it("prefers explicit subagents.model over economyModel", () => {
    const cfg = {
      agents: {
        defaults: {
          model: { primary: "anthropic/claude-opus-4-8" },
          economyModel: "google/gemini-3.5-flash",
          subagents: { model: "openai/gpt-5.4-mini" },
        },
      },
    } as unknown as OpenClawConfig;
    expect(resolveSubagentSpawnModelSelection({ cfg, agentId: "main" })).toBe(
      "openai/gpt-5.4-mini",
    );
  });

  it("prefers an explicit spawn override over economyModel", () => {
    const cfg = {
      agents: {
        defaults: {
          model: { primary: "anthropic/claude-opus-4-8" },
          economyModel: "google/gemini-3.5-flash",
        },
      },
    } as unknown as OpenClawConfig;
    expect(
      resolveSubagentSpawnModelSelection({
        cfg,
        agentId: "main",
        modelOverride: "anthropic/claude-haiku-4-5",
      }),
    ).toBe("anthropic/claude-haiku-4-5");
  });

  it("falls back to the primary model when economyModel is unset", () => {
    const cfg = {
      agents: {
        defaults: {
          model: { primary: "anthropic/claude-opus-4-8" },
        },
      },
    } as unknown as OpenClawConfig;
    expect(resolveSubagentSpawnModelSelection({ cfg, agentId: "main" })).toBe(
      "anthropic/claude-opus-4-8",
    );
  });
});
