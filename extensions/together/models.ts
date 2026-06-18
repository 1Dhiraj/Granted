import type { ModelDefinitionConfig } from "openclaw/plugin-sdk/provider-model-shared";

export const TOGETHER_BASE_URL = "https://api.together.xyz/v1";

// Minimal seed catalog — only used as a static fallback when the live
// /v1/models API call fails. The real model list is populated dynamically
// by `augmentModelCatalog` in extensions/together/index.ts so users always
// see the full catalog Together AI offers (100+ models, updated frequently).
export const TOGETHER_MODEL_CATALOG: ModelDefinitionConfig[] = [
  {
    id: "moonshotai/Kimi-K2.5",
    name: "Kimi K2.5",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 262144,
    maxTokens: 32768,
    cost: { input: 0.5, output: 2.8, cacheRead: 0.5, cacheWrite: 0.5 },
  },
  {
    id: "deepseek-ai/DeepSeek-V3.1",
    name: "DeepSeek V3.1",
    reasoning: false,
    input: ["text"],
    contextWindow: 131072,
    maxTokens: 8192,
    cost: { input: 0.6, output: 1.25, cacheRead: 0.6, cacheWrite: 0.6 },
  },
  {
    id: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    name: "Llama 3.3 70B Turbo",
    reasoning: false,
    input: ["text"],
    contextWindow: 131072,
    maxTokens: 8192,
    cost: { input: 0.88, output: 0.88, cacheRead: 0.88, cacheWrite: 0.88 },
  },
];

export function buildTogetherModelDefinition(
  model: (typeof TOGETHER_MODEL_CATALOG)[number],
): ModelDefinitionConfig {
  return {
    id: model.id,
    name: model.name,
    api: "openai-completions",
    reasoning: model.reasoning,
    input: model.input,
    cost: model.cost,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
  };
}
