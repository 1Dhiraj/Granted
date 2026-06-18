import {
  ensureAuthProfileStore,
  updateAuthProfileStoreWithLock,
} from "../../agents/auth-profiles/store.js";
import { resetModelCatalog } from "../../agents/model-catalog.js";
import { updateConfig } from "../../commands/models/shared.js";
import { applyAuthProfileConfig } from "../../plugins/provider-auth-helpers.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

type KnownProvider = {
  id: string;
  label: string;
  description: string;
  authType: "api_key" | "url" | "none";
  docsUrl: string;
  keyHint: string;
};

export const KNOWN_PROVIDERS: KnownProvider[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    description: "Claude models — Opus, Sonnet, Haiku",
    authType: "api_key",
    docsUrl: "https://console.anthropic.com/settings/keys",
    keyHint: "sk-ant-...",
  },
  {
    id: "openai",
    label: "OpenAI",
    description: "GPT-4o, o1, o3 and GPT-4 series",
    authType: "api_key",
    docsUrl: "https://platform.openai.com/api-keys",
    keyHint: "sk-...",
  },
  {
    id: "google",
    label: "Google Gemini",
    description: "Gemini 2.5 Pro, Flash, and Nano",
    authType: "api_key",
    docsUrl: "https://aistudio.google.com/apikey",
    keyHint: "AIza...",
  },
  {
    id: "mistral",
    label: "Mistral",
    description: "Mistral Large, Small, Codestral",
    authType: "api_key",
    docsUrl: "https://console.mistral.ai/api-keys/",
    keyHint: "...",
  },
  {
    id: "groq",
    label: "Groq",
    description: "Ultra-fast inference — Llama, Mixtral, Gemma",
    authType: "api_key",
    docsUrl: "https://console.groq.com/keys",
    keyHint: "gsk_...",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    description: "DeepSeek V3 and R1 reasoning models",
    authType: "api_key",
    docsUrl: "https://platform.deepseek.com/api_keys",
    keyHint: "sk-...",
  },
  {
    id: "together",
    label: "Together AI",
    description: "Open-source models at scale",
    authType: "api_key",
    docsUrl: "https://api.together.xyz/settings/api-keys",
    keyHint: "...",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    description: "Unified access to 200+ models",
    authType: "api_key",
    docsUrl: "https://openrouter.ai/settings/keys",
    keyHint: "sk-or-...",
  },
  {
    id: "perplexity",
    label: "Perplexity",
    description: "Web-search augmented AI models",
    authType: "api_key",
    docsUrl: "https://www.perplexity.ai/settings/api",
    keyHint: "pplx-...",
  },
  {
    id: "nvidia",
    label: "NVIDIA NIM",
    description: "Llama, Mistral, and more via NVIDIA's inference cloud",
    authType: "api_key",
    docsUrl: "https://build.nvidia.com/settings/api-keys",
    keyHint: "nvapi-...",
  },
  {
    id: "xai",
    label: "xAI (Grok)",
    description: "Grok-2 and Grok Vision models by xAI",
    authType: "api_key",
    docsUrl: "https://console.x.ai/",
    keyHint: "xai-...",
  },
  {
    id: "fireworks",
    label: "Fireworks AI",
    description: "Fast open-source model inference — Llama, Mixtral, and more",
    authType: "api_key",
    docsUrl: "https://fireworks.ai/account/api-keys",
    keyHint: "fw_...",
  },
  {
    id: "huggingface",
    label: "Hugging Face",
    description: "Inference API — thousands of open-source models",
    authType: "api_key",
    docsUrl: "https://huggingface.co/settings/tokens",
    keyHint: "hf_...",
  },
  {
    id: "ollama",
    label: "Ollama (Local)",
    description: "Run models locally on your machine — no API key needed",
    authType: "url",
    docsUrl: "https://ollama.com/download",
    keyHint: "http://127.0.0.1:11434",
  },
];

const DEFAULT_PROFILE_SUFFIX = "default";
const OLLAMA_DEFAULT_BASE_URL = "http://127.0.0.1:11434";
const FETCH_TIMEOUT_MS = 5000;

function resolveProfileId(providerId: string): string {
  return `${providerId}:${DEFAULT_PROFILE_SUFFIX}`;
}

function maskKey(key: string): string {
  if (!key || key.length <= 8) {
    return "****";
  }
  return `${key.slice(0, 6)}****`;
}

function resolveOllamaBaseUrl(profiles: Record<string, unknown>): string {
  const profile = profiles[resolveProfileId("ollama")] as
    | { type?: string; metadata?: Record<string, string> }
    | undefined;
  return profile?.type === "api_key" && profile.metadata?.baseUrl
    ? profile.metadata.baseUrl
    : OLLAMA_DEFAULT_BASE_URL;
}

export const providersHandlers: GatewayRequestHandlers = {
  "providers.list": ({ respond }) => {
    try {
      const store = ensureAuthProfileStore();
      const items = KNOWN_PROVIDERS.map((provider) => {
        const profileId = resolveProfileId(provider.id);
        const profile = store.profiles[profileId] as
          | { type?: string; key?: string; metadata?: Record<string, string> }
          | undefined;

        let configured = false;
        let maskedKey: string | undefined;
        let metaUrl: string | undefined;

        if (profile?.type === "api_key") {
          if (provider.authType === "url") {
            metaUrl = profile.metadata?.baseUrl ?? OLLAMA_DEFAULT_BASE_URL;
            configured = true;
          } else if (profile.key) {
            configured = true;
            maskedKey = maskKey(profile.key);
          }
        }

        return {
          id: provider.id,
          label: provider.label,
          description: provider.description,
          authType: provider.authType,
          docsUrl: provider.docsUrl,
          keyHint: provider.keyHint,
          configured,
          maskedKey,
          metaUrl,
        };
      });
      respond(true, { providers: items });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "providers.setKey": async ({ params, respond }) => {
    const p = params as { providerId?: unknown; key?: unknown; baseUrl?: unknown };
    const providerId = typeof p.providerId === "string" ? p.providerId.trim() : "";
    const key = typeof p.key === "string" ? p.key.trim() : "";
    const baseUrl = typeof p.baseUrl === "string" ? p.baseUrl.trim() : "";

    if (!providerId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "providerId is required"));
      return;
    }

    const knownProvider = KNOWN_PROVIDERS.find((kp) => kp.id === providerId);
    if (!knownProvider) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `unknown provider: ${providerId}`),
      );
      return;
    }

    if (knownProvider.authType === "api_key" && !key) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "key is required for this provider"),
      );
      return;
    }

    if (knownProvider.authType === "url" && !baseUrl) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "baseUrl is required for Ollama"),
      );
      return;
    }

    const profileId = resolveProfileId(providerId);

    try {
      const updated = await updateAuthProfileStoreWithLock({
        updater: (store) => {
          if (knownProvider.authType === "api_key") {
            store.profiles[profileId] = {
              type: "api_key",
              provider: providerId,
              key,
            };
          } else {
            // Ollama — store synthetic key + base URL
            store.profiles[profileId] = {
              type: "api_key",
              provider: providerId,
              key: "ollama-local",
              metadata: { baseUrl },
            };
          }
          return true;
        },
      });
      if (!updated) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "Failed to save — file lock error"));
        return;
      }

      // Also register the profile in openclaw.json so the runtime can discover it.
      if (knownProvider.authType === "api_key") {
        await updateConfig((cfg) =>
          applyAuthProfileConfig(cfg, { profileId, provider: providerId, mode: "api_key" }),
        ).catch(() => {});
      } else if (knownProvider.authType === "url") {
        // For Ollama: write baseUrl to models.providers.ollama so the stream uses the right URL.
        await updateConfig((cfg) => {
          const existingProvider = cfg.models?.providers?.[providerId];
          const updatedProvider = { models: [], ...(existingProvider ?? {}), baseUrl };
          return {
            ...cfg,
            models: {
              ...cfg.models,
              providers: {
                ...cfg.models?.providers,
                [providerId]: updatedProvider as import("../../config/types.models.js").ModelProviderConfig,
              },
            },
          };
        }).catch(() => {});
      }

      respond(true, { ok: true });
      resetModelCatalog();
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "providers.deleteKey": async ({ params, respond }) => {
    const p = params as { providerId?: unknown };
    const providerId = typeof p.providerId === "string" ? p.providerId.trim() : "";

    if (!providerId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "providerId is required"));
      return;
    }

    const profileId = resolveProfileId(providerId);

    try {
      await updateAuthProfileStoreWithLock({
        updater: (store) => {
          if (!(profileId in store.profiles)) {
            return false;
          }
          delete store.profiles[profileId];
          return true;
        },
      });

      // Remove the profile entry from openclaw.json as well.
      await updateConfig((cfg) => {
        if (!cfg.auth?.profiles || !(profileId in cfg.auth.profiles)) {
          return cfg;
        }
        const nextProfiles = { ...cfg.auth.profiles };
        delete nextProfiles[profileId];
        const nextOrder: Record<string, string[]> = {};
        for (const [k, v] of Object.entries(cfg.auth?.order ?? {})) {
          const filtered = v.filter((id) => id !== profileId);
          if (filtered.length > 0) nextOrder[k] = filtered;
        }
        return {
          ...cfg,
          auth: {
            ...cfg.auth,
            profiles: nextProfiles,
            ...(Object.keys(nextOrder).length > 0 ? { order: nextOrder } : { order: undefined }),
          },
        };
      }).catch(() => {
        // Non-fatal: key is already removed from auth-profiles.json.
      });

      respond(true, { ok: true });
      resetModelCatalog();
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "providers.listModels": async ({ params, respond }) => {
    const p = params as { providerId?: unknown };
    const providerId = typeof p.providerId === "string" ? p.providerId.trim() : "";

    if (!providerId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "providerId is required"));
      return;
    }

    const isLocalProvider = providerId === "ollama" || providerId === "lmstudio";
    if (!isLocalProvider) {
      // Cloud providers: return empty — models come from the main catalog
      respond(true, { models: [] });
      return;
    }

    try {
      const store = ensureAuthProfileStore();
      const profile = store.profiles[resolveProfileId(providerId)] as
        | { type?: string; metadata?: Record<string, string> }
        | undefined;
      const defaultUrl = providerId === "lmstudio" ? "http://127.0.0.1:1234" : OLLAMA_DEFAULT_BASE_URL;
      const baseUrl =
        profile?.type === "api_key" && profile.metadata?.baseUrl
          ? profile.metadata.baseUrl
          : defaultUrl;

      const response = await fetch(`${baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.UNAVAILABLE,
            `Ollama returned HTTP ${response.status}. Is Ollama running at ${baseUrl}?`,
          ),
        );
        return;
      }

      const data = (await response.json()) as {
        models?: Array<{
          name: string;
          details?: { family?: string; parameter_size?: string };
        }>;
      };

      const models = (data.models ?? []).map((m) => ({
        id: m.name,
        label: m.name,
        provider: "ollama",
        family: m.details?.family ?? null,
        parameterSize: m.details?.parameter_size ?? null,
      }));

      respond(true, { models, baseUrl });
      resetModelCatalog();
    } catch (err) {
      const message = String(err);
      const hint =
        message.includes("ECONNREFUSED") || message.includes("fetch")
          ? providerId === "lmstudio"
            ? "LM Studio server is not running. Start it from the LM Studio app → Local Server."
            : "Ollama is not running. Start it with: ollama serve"
          : message;
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, hint));
    }
  },
};
