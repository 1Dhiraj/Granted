import { defineSingleProviderPluginEntry } from "openclaw/plugin-sdk/provider-entry";
import type { ProviderAugmentModelCatalogContext } from "openclaw/plugin-sdk/core";
import { TOGETHER_BASE_URL } from "./models.js";
import { applyTogetherConfig, TOGETHER_DEFAULT_MODEL_REF } from "./onboard.js";
import { buildTogetherProvider } from "./provider-catalog.js";
import { buildTogetherVideoGenerationProvider } from "./video-generation-provider.js";

const PROVIDER_ID = "together";

type TogetherApiModel = {
  id: string;
  display_name?: string;
  type?: string;
  context_length?: number;
  pricing_tier?: string;
  pricing?: {
    input?: number;
    output?: number;
    hourly?: number;
    base?: number;
    finetune?: number;
  };
};

export default defineSingleProviderPluginEntry({
  id: PROVIDER_ID,
  name: "Together Provider",
  description: "Bundled Together provider plugin",
  provider: {
    label: "Together",
    docsPath: "/providers/together",
    auth: [
      {
        methodId: "api-key",
        label: "Together AI API key",
        hint: "API key",
        optionKey: "togetherApiKey",
        flagName: "--together-api-key",
        envVar: "TOGETHER_API_KEY",
        promptMessage: "Enter Together AI API key",
        defaultModel: TOGETHER_DEFAULT_MODEL_REF,
        applyConfig: (cfg) => applyTogetherConfig(cfg),
        wizard: {
          groupLabel: "Together AI",
        },
      },
    ],
    catalog: {
      buildProvider: buildTogetherProvider,
    },
    classifyFailoverReason: ({ errorMessage }) => {
      if (/\bconcurrency limit\b.*\b(?:breached|reached)\b/i.test(errorMessage)) {
        return "rate_limit";
      }
      // Together returns this when a model in the catalog is dedicated-only
      // and has no live serverless deployment. Map to model_not_found so the
      // dispatcher fails over instead of treating it as a transient error.
      if (/Unable to access non-serverless model/i.test(errorMessage)) {
        return "model_not_found";
      }
      return undefined;
    },
    // Dynamically fetch ALL chat models from Together AI's /v1/models endpoint.
    // This ensures the model dropdown always shows the live, complete list rather
    // than a stale hardcoded subset.
    augmentModelCatalog: async (ctx: ProviderAugmentModelCatalogContext) => {
      try {
        const explicit = (ctx.config?.models?.providers as Record<string, { apiKey?: unknown; baseUrl?: unknown }>)?.[PROVIDER_ID];
        const explicitApiKey = typeof explicit?.apiKey === "string" ? explicit.apiKey.trim() : "";
        const explicitBaseUrl = typeof explicit?.baseUrl === "string" ? explicit.baseUrl.trim() : "";
        // Try config first, then env, then auth-profiles.json
        let apiKey =
          explicitApiKey ||
          (ctx.env ?? process.env).TOGETHER_API_KEY?.trim();
        if (!apiKey && ctx.agentDir) {
          try {
            const { readFile } = await import("node:fs/promises");
            const profiles = JSON.parse(
              await readFile(`${ctx.agentDir}/auth-profiles.json`, "utf8"),
            ) as { profiles?: Record<string, { key?: string }> };
            apiKey = profiles.profiles?.["together:default"]?.key?.trim();
          } catch {
            // auth-profiles.json not found or not readable
          }
        }
        if (!apiKey) return [];
        const baseUrl = explicitBaseUrl || TOGETHER_BASE_URL;
        // `?serverless=true` is the only reliable signal Together exposes for
        // serverless availability. The default /v1/models response includes
        // dedicated-endpoint-only models (e.g. nvidia/Llama-3.1-Nemotron-70B-
        // Instruct-HF) that look identical to serverless ones in their pricing
        // and metadata fields, but error with "Unable to access non-serverless
        // model" on inference. The query param makes Together filter server-side.
        const response = await fetch(`${baseUrl}/models?serverless=true`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) return [];
        const data = (await response.json()) as TogetherApiModel[] | { data?: TogetherApiModel[] };
        const models = Array.isArray(data) ? data : (data.data ?? []);
        return models
          .filter((m) => {
            const t = (m.type ?? "").toLowerCase();
            return t === "chat" || t === "language" || t === "code";
          })
          .map((m) => ({
            id: m.id,
            name: m.display_name?.trim() || m.id,
            provider: PROVIDER_ID,
            ...(typeof m.context_length === "number" && m.context_length > 0
              ? { contextWindow: m.context_length }
              : {}),
          }));
      } catch {
        return [];
      }
    },
  },
  register(api) {
    api.registerVideoGenerationProvider(buildTogetherVideoGenerationProvider());
  },
});
