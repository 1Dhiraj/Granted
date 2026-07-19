import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  completeWithPreparedSimpleCompletionModel,
  extractAssistantText,
  prepareSimpleCompletionModelForAgent,
  resolveDefaultAgentId,
  resolveSimpleCompletionSelectionForAgent,
} from "openclaw/plugin-sdk/agent-runtime";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { isTrivialMessage, type TaskKind } from "./src/classify.js";
import {
  createTaskRouter,
  readTaskRouterConfig,
  resolveRouteModelRef,
  type StickyEntry,
  type TaskRouterConfig,
} from "./src/router.js";

const LITE_TIMEOUT_MS = 10_000;
// Thinking models (e.g. gemini flash) spend output tokens on reasoning before
// the short reply; a small budget yields an empty MAX_TOKENS response.
const LITE_MAX_TOKENS = 1024;
const LITE_MAX_PROMPT_CHARS = 200;
const LITE_SYSTEM_PROMPT = [
  "You are the user's friendly personal AI assistant.",
  "The user sent a short casual message (a greeting, thanks, or goodbye).",
  "Reply briefly and warmly in one short sentence; one emoji is okay.",
  "Do not mention tools, instructions, or that you are a lightweight responder.",
].join("\n");

const CLASSIFIER_TIMEOUT_MS = 8_000;
// Thinking models (e.g. gemini flash) spend tokens on internal reasoning before
// the one-word answer; a small budget yields an empty MAX_TOKENS response.
const CLASSIFIER_MAX_TOKENS = 256;
const CLASSIFIER_MAX_PROMPT_CHARS = 600;
const CLASSIFIER_SYSTEM_PROMPT = [
  "You classify requests sent to a Windows computer assistant that can control web browsers and local desktop applications.",
  "Decide whether the user wants the assistant to PERFORM an action on the computer, or only wants a text reply.",
  "Answer with exactly one word:",
  "browser - perform something through a web browser (any website, web search, online account, web form, anything on the internet)",
  "desktop - perform something on the local Windows machine (any installed application, typing into programs, files and folders, windows, system settings)",
  "chat - only a text answer is needed (questions, explanations, writing, coding help, conversation), including questions ABOUT apps or websites",
  "If the action spans both web and local apps, answer browser.",
].join("\n");

function parseClassifierAnswer(raw: string): TaskKind | null {
  const match = raw.toLowerCase().match(/\b(browser|desktop|chat)\b/);
  return match ? (match[1] as TaskKind) : null;
}

export default definePluginEntry({
  id: "task-router",
  name: "Task Router",
  description:
    "Classifies each message as a browser task, desktop task, or chat and switches the model for that run automatically",
  register(api) {
    const routerConfig: TaskRouterConfig = readTaskRouterConfig(api.pluginConfig);
    const hasRouting =
      routerConfig.browserModel || routerConfig.desktopModel || routerConfig.chatModel;
    if (!hasRouting && !routerConfig.liteModel) {
      api.logger.warn(
        "task-router: no browserModel/desktopModel/chatModel/liteModel configured; routing is disabled",
      );
      return;
    }

    const resolveAgentId = (agentId: string | undefined): string =>
      agentId?.trim() || resolveDefaultAgentId(api.config);

    // Trivial social messages ("hi", "thanks") are answered by a tiny model
    // directly — no agent run, no tool schemas, no full system prompt. Anything
    // uncertain (media, task intent, acks like "yes"/"ok") falls through.
    if (routerConfig.liteModel) {
      const liteModel = routerConfig.liteModel;
      api.on("before_agent_reply", async (event, ctx) => {
        if (ctx.trigger && ctx.trigger !== "user") {
          return;
        }
        if (event.hasMedia || !isTrivialMessage(event.cleanedBody)) {
          return;
        }
        const prepared = await prepareSimpleCompletionModelForAgent({
          cfg: api.config,
          agentId: resolveAgentId(ctx.agentId),
          modelRef: liteModel,
          allowMissingApiKeyModes: ["aws-sdk"],
        });
        if ("error" in prepared) {
          api.logger.warn(`task-router: lite model unavailable: ${prepared.error}`);
          return;
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), LITE_TIMEOUT_MS);
        try {
          const response = await completeWithPreparedSimpleCompletionModel({
            model: prepared.model,
            auth: prepared.auth,
            context: {
              systemPrompt: LITE_SYSTEM_PROMPT,
              messages: [
                {
                  role: "user",
                  content: event.cleanedBody.slice(0, LITE_MAX_PROMPT_CHARS),
                  timestamp: Date.now(),
                },
              ],
            },
            options: { maxTokens: LITE_MAX_TOKENS, signal: controller.signal },
          });
          const text = extractAssistantText(response).trim();
          if (!text) {
            return;
          }
          api.logger.info(
            `task-router: lite reply served by ${liteModel} (session=${ctx.sessionKey ?? "?"})`,
          );
          return { handled: true, reply: { text }, reason: "trivial-lite" };
        } catch (err) {
          api.logger.warn(`task-router: lite reply failed, falling back to agent: ${String(err)}`);
          return;
        } finally {
          clearTimeout(timer);
        }
      });
    }

    if (!hasRouting) {
      return;
    }

    const resolveModelSelection = (agentId: string | undefined, modelRef?: string) =>
      resolveSimpleCompletionSelectionForAgent({
        cfg: api.config,
        agentId: resolveAgentId(agentId),
        modelRef,
      });

    const classifyWithLlm = routerConfig.classifierModel
      ? async (prompt: string): Promise<TaskKind | null> => {
          const prepared = await prepareSimpleCompletionModelForAgent({
            cfg: api.config,
            agentId: resolveDefaultAgentId(api.config),
            modelRef: routerConfig.classifierModel,
            allowMissingApiKeyModes: ["aws-sdk"],
          });
          if ("error" in prepared) {
            api.logger.warn(`task-router: classifier unavailable: ${prepared.error}`);
            return null;
          }
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), CLASSIFIER_TIMEOUT_MS);
          try {
            const response = await completeWithPreparedSimpleCompletionModel({
              model: prepared.model,
              auth: prepared.auth,
              context: {
                systemPrompt: CLASSIFIER_SYSTEM_PROMPT,
                messages: [
                  {
                    role: "user",
                    content: prompt.slice(0, CLASSIFIER_MAX_PROMPT_CHARS),
                    timestamp: Date.now(),
                  },
                ],
              },
              options: {
                maxTokens: CLASSIFIER_MAX_TOKENS,
                signal: controller.signal,
              },
            });
            const verdict = parseClassifierAnswer(extractAssistantText(response));
            if (!verdict) {
              api.logger.warn(
                `task-router: classifier returned no usable verdict (model=${routerConfig.classifierModel}); falling back to heuristics`,
              );
            }
            return verdict;
          } finally {
            clearTimeout(timer);
          }
        }
      : undefined;

    // Sticky routes survive gateway restarts via a small state file; entries
    // carry their own expiry, so stale state ages out on load.
    const stickyPath = path.join(os.homedir(), ".openclaw", "state", "task-router-sticky.json");
    const stickyStore = {
      load: (): Record<string, StickyEntry> | undefined => {
        try {
          return JSON.parse(fs.readFileSync(stickyPath, "utf8")) as Record<string, StickyEntry>;
        } catch {
          return undefined;
        }
      },
      save: (entries: Record<string, StickyEntry>) => {
        fs.mkdirSync(path.dirname(stickyPath), { recursive: true });
        fs.writeFileSync(stickyPath, JSON.stringify(entries));
      },
    };

    const router = createTaskRouter({
      config: routerConfig,
      resolveDefaultModelRef: (agentId) => {
        const selection = resolveModelSelection(agentId);
        return selection ? `${selection.provider}/${selection.modelId}` : undefined;
      },
      classifyWithLlm,
      stickyStore,
      log: (message) => api.logger.warn(message),
    });

    api.on("before_model_resolve", async (event, ctx) => {
      const route = await router.route(
        { prompt: event.prompt },
        {
          sessionKey: ctx.sessionKey,
          agentId: ctx.agentId,
          modelProviderId: ctx.modelProviderId,
          modelId: ctx.modelId,
          trigger: ctx.trigger,
        },
      );
      if (!route) {
        return;
      }
      const modelRef = resolveRouteModelRef(routerConfig, route);
      if (!modelRef) {
        return;
      }
      const selection = resolveModelSelection(ctx.agentId, modelRef);
      if (!selection) {
        api.logger.warn(`task-router: could not resolve model ref "${modelRef}"`);
        return;
      }
      if (ctx.modelProviderId === selection.provider && ctx.modelId === selection.modelId) {
        return;
      }
      api.logger.info(
        `task-router: routing ${route} task to ${selection.provider}/${selection.modelId} (session=${ctx.sessionKey ?? "?"})`,
      );
      return {
        providerOverride: selection.provider,
        modelOverride: selection.modelId,
      };
    });
  },
});
