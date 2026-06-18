import type { ProviderResolveDynamicModelContext } from "openclaw/plugin-sdk/plugin-entry";
import { defineSingleProviderPluginEntry } from "openclaw/plugin-sdk/provider-entry";
import {
  cloneFirstTemplateModel,
  normalizeModelCompat,
} from "openclaw/plugin-sdk/provider-model-shared";
import {
  buildNvidiaProvider,
  NVIDIA_BASE_URL,
  NVIDIA_DEFAULT_CONTEXT_WINDOW,
  NVIDIA_DEFAULT_MAX_TOKENS,
  NVIDIA_DEFAULT_MODEL_ID,
} from "./provider-catalog.js";

const PROVIDER_ID = "nvidia";

function resolveNvidiaDynamicModel(ctx: ProviderResolveDynamicModelContext) {
  const modelId = ctx.modelId.trim();
  if (!modelId) {
    return undefined;
  }

  // NVIDIA model IDs include the org prefix (e.g. "nvidia/nemotron-3-super-120b-a12b").
  // The runtime strips everything before the first "/" when looking up by provider,
  // so ctx.modelId arrives as "nemotron-3-super-120b-a12b". Re-attach the prefix
  // by checking both forms against the catalog, then build the full model config.
  const catalog = buildNvidiaProvider();
  const fullModelId = modelId.includes("/") ? modelId : `nvidia/${modelId}`;
  const catalogModel = catalog.models?.find(
    (m) => m.id === fullModelId || m.id === modelId,
  );

  return (
    cloneFirstTemplateModel({
      providerId: PROVIDER_ID,
      modelId: catalogModel?.id ?? fullModelId,
      templateIds: [NVIDIA_DEFAULT_MODEL_ID],
      ctx,
      patch: { provider: PROVIDER_ID },
    }) ??
    normalizeModelCompat({
      id: catalogModel?.id ?? fullModelId,
      name: catalogModel?.name ?? fullModelId,
      provider: PROVIDER_ID,
      api: "openai-completions",
      baseUrl: NVIDIA_BASE_URL,
      reasoning: catalogModel?.reasoning ?? false,
      input: catalogModel?.input ?? ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: catalogModel?.contextWindow ?? NVIDIA_DEFAULT_CONTEXT_WINDOW,
      maxTokens: catalogModel?.maxTokens ?? NVIDIA_DEFAULT_MAX_TOKENS,
    })
  );
}

export default defineSingleProviderPluginEntry({
  id: PROVIDER_ID,
  name: "NVIDIA Provider",
  description: "Bundled NVIDIA provider plugin",
  provider: {
    label: "NVIDIA",
    docsPath: "/providers/nvidia",
    envVars: ["NVIDIA_API_KEY"],
    auth: [],
    catalog: {
      buildProvider: buildNvidiaProvider,
    },
    augmentModelCatalog: () => {
      const provider = buildNvidiaProvider();
      return (provider.models ?? []).map((model) => ({
        id: model.id,
        name: model.name,
        provider: PROVIDER_ID,
        contextWindow: model.contextWindow,
        reasoning: model.reasoning,
        input: model.input,
      }));
    },
    resolveDynamicModel: (ctx) => resolveNvidiaDynamicModel(ctx),
  },
});
