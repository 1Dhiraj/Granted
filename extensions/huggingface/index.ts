import type { ProviderResolveDynamicModelContext } from "openclaw/plugin-sdk/plugin-entry";
import { defineSingleProviderPluginEntry } from "openclaw/plugin-sdk/provider-entry";
import {
  cloneFirstTemplateModel,
  normalizeModelCompat,
} from "openclaw/plugin-sdk/provider-model-shared";
import { applyHuggingfaceConfig, HUGGINGFACE_DEFAULT_MODEL_REF } from "./onboard.js";
import {
  buildHuggingfaceModelDefinition,
  buildHuggingfaceProvider,
  HUGGINGFACE_BASE_URL,
  HUGGINGFACE_MODEL_CATALOG,
} from "./provider-catalog.js";

const PROVIDER_ID = "huggingface";

type HuggingFacePluginConfig = {
  discovery?: {
    enabled?: boolean;
  };
};

// The default model ID without the provider prefix for template cloning.
const HUGGINGFACE_DEFAULT_MODEL_ID = "deepseek-ai/DeepSeek-R1";

function resolveHuggingfaceDynamicModel(ctx: ProviderResolveDynamicModelContext) {
  const modelId = ctx.modelId.trim();
  if (!modelId) {
    return undefined;
  }

  // ctx.modelId arrives as the part after "huggingface/" in the full ref,
  // e.g. "deepseek-ai/DeepSeek-R1" — which is exactly the HuggingFace model ID.
  const catalogEntry = HUGGINGFACE_MODEL_CATALOG.find((m) => m.id === modelId);
  const catalogModel = catalogEntry ? buildHuggingfaceModelDefinition(catalogEntry) : undefined;

  return (
    cloneFirstTemplateModel({
      providerId: PROVIDER_ID,
      modelId,
      templateIds: [HUGGINGFACE_DEFAULT_MODEL_ID],
      ctx,
      patch: { provider: PROVIDER_ID },
    }) ??
    normalizeModelCompat({
      id: modelId,
      name: catalogModel?.name ?? modelId,
      provider: PROVIDER_ID,
      api: "openai-completions",
      baseUrl: HUGGINGFACE_BASE_URL,
      reasoning: catalogModel?.reasoning ?? false,
      input: catalogModel?.input ?? ["text"],
      cost: catalogModel?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: catalogModel?.contextWindow ?? 131072,
      maxTokens: catalogModel?.maxTokens ?? 8192,
    })
  );
}

export default defineSingleProviderPluginEntry({
  id: PROVIDER_ID,
  name: "Hugging Face Provider",
  description: "Bundled Hugging Face provider plugin",
  provider: {
    label: "Hugging Face",
    docsPath: "/providers/huggingface",
    envVars: ["HUGGINGFACE_HUB_TOKEN", "HF_TOKEN"],
    auth: [
      {
        methodId: "api-key",
        label: "Hugging Face API key",
        hint: "Inference API (HF token)",
        optionKey: "huggingfaceApiKey",
        flagName: "--huggingface-api-key",
        envVar: "HUGGINGFACE_HUB_TOKEN",
        promptMessage: "Enter Hugging Face API key",
        defaultModel: HUGGINGFACE_DEFAULT_MODEL_REF,
        applyConfig: (cfg) => applyHuggingfaceConfig(cfg),
      },
    ],
    catalog: {
      order: "simple",
      run: async (ctx) => {
        const pluginEntry = ctx.config?.plugins?.entries?.[PROVIDER_ID];
        const pluginConfig =
          pluginEntry && typeof pluginEntry === "object" && pluginEntry.config
            ? (pluginEntry.config as HuggingFacePluginConfig)
            : undefined;
        const discoveryEnabled =
          pluginConfig?.discovery?.enabled ?? ctx.config?.models?.huggingfaceDiscovery?.enabled;
        if (discoveryEnabled === false) {
          return null;
        }
        const { apiKey, discoveryApiKey } = ctx.resolveProviderApiKey(PROVIDER_ID);
        if (!apiKey) {
          return null;
        }
        return {
          provider: {
            ...(await buildHuggingfaceProvider(discoveryApiKey)),
            apiKey,
          },
        };
      },
    },
    augmentModelCatalog: () => {
      return HUGGINGFACE_MODEL_CATALOG.map((model) => {
        const def = buildHuggingfaceModelDefinition(model);
        return {
          id: def.id,
          name: def.name,
          provider: PROVIDER_ID,
          contextWindow: def.contextWindow,
          reasoning: def.reasoning,
          input: def.input,
        };
      });
    },
    resolveDynamicModel: (ctx) => resolveHuggingfaceDynamicModel(ctx),
  },
});
