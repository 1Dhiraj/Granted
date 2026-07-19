import { describe, expect, it, vi } from "vitest";
import {
  createTaskRouter,
  readTaskRouterConfig,
  resolveRouteModelRef,
  type StickyEntry,
} from "./router.js";

const DEFAULT_REF = "nvidia/deepseek-ai/deepseek-v4-flash";

function makeRouter(overrides?: Partial<Parameters<typeof createTaskRouter>[0]>) {
  return createTaskRouter({
    config: {
      browserModel: "together/moonshotai/Kimi-K2.6",
      desktopModel: "together/moonshotai/Kimi-K2.6",
      stickyMinutes: 30,
    },
    resolveDefaultModelRef: () => DEFAULT_REF,
    ...overrides,
  });
}

const defaultCtx = {
  sessionKey: "agent:main:webchat",
  agentId: "main",
  modelProviderId: "nvidia",
  modelId: "deepseek-ai/deepseek-v4-flash",
};

describe("createTaskRouter", () => {
  it("routes automation prompts and leaves chat prompts alone", async () => {
    const router = makeRouter();
    await expect(router.route({ prompt: "open notepad and type hi" }, defaultCtx)).resolves.toBe(
      "desktop",
    );
    await expect(
      router.route({ prompt: "search for shoes on amazon" }, { ...defaultCtx, sessionKey: "s2" }),
    ).resolves.toBe("browser");
    await expect(
      router.route({ prompt: "write a haiku" }, { ...defaultCtx, sessionKey: "s3" }),
    ).resolves.toBeUndefined();
  });

  it("keeps the routed model for follow-up messages and refreshes the window on use", async () => {
    let nowMs = 0;
    const router = makeRouter({ now: () => nowMs });
    await expect(router.route({ prompt: "open notepad and type hi" }, defaultCtx)).resolves.toBe(
      "desktop",
    );
    // Long task: each follow-up extends the window, so step 3 at minute 45
    // still rides the automation model even though 30min passed since routing.
    nowMs = 25 * 60_000;
    await expect(router.route({ prompt: "yes, continue" }, defaultCtx)).resolves.toBe("desktop");
    nowMs = 45 * 60_000;
    await expect(router.route({ prompt: "looks good, next step" }, defaultCtx)).resolves.toBe(
      "desktop",
    );
    // 30+ minutes of inactivity ends the task window.
    nowMs = 90 * 60_000;
    await expect(router.route({ prompt: "thanks!" }, defaultCtx)).resolves.toBeUndefined();
  });

  it("routes chat prompts to the chat model when configured, without stickiness", async () => {
    const router = makeRouter({
      config: {
        browserModel: "together/moonshotai/Kimi-K2.6",
        chatModel: "google/gemini-2.0-flash",
        stickyMinutes: 30,
      },
    });
    await expect(
      router.route({ prompt: "what is the capital of france?" }, defaultCtx),
    ).resolves.toBe("chat");
    // Automation classification still wins over chat on the next message.
    await expect(router.route({ prompt: "open notepad and type hi" }, defaultCtx)).resolves.toBe(
      "desktop",
    );
    // Mid-automation follow-up keeps the automation route, not chat.
    await expect(
      router.route({ prompt: "what does the error on screen mean?" }, defaultCtx),
    ).resolves.toBe("desktop");
  });

  it("resolves the chat route to the chatModel ref", () => {
    const config = readTaskRouterConfig({
      chatModel: "google/gemini-2.0-flash",
      browserModel: "together/x",
    });
    expect(resolveRouteModelRef(config, "chat")).toBe("google/gemini-2.0-flash");
    expect(resolveRouteModelRef(config, "browser")).toBe("together/x");
  });

  it("leaves chat prompts alone when no chatModel is configured", async () => {
    const router = makeRouter();
    await expect(
      router.route({ prompt: "write a haiku" }, { ...defaultCtx, sessionKey: "s9" }),
    ).resolves.toBeUndefined();
  });

  it("skips non-user triggers", async () => {
    const router = makeRouter();
    await expect(
      router.route({ prompt: "open notepad" }, { ...defaultCtx, trigger: "heartbeat" }),
    ).resolves.toBeUndefined();
  });

  it("respects a manual session model override", async () => {
    const router = makeRouter();
    await expect(
      router.route(
        { prompt: "open notepad and type hi" },
        { ...defaultCtx, modelProviderId: "together", modelId: "moonshotai/Kimi-K2.6" },
      ),
    ).resolves.toBeUndefined();
  });

  it("prefers the LLM classifier over keyword heuristics", async () => {
    const classifyWithLlm = vi.fn().mockResolvedValue("browser");
    const router = makeRouter({ classifyWithLlm });
    await expect(
      router.route({ prompt: "get me two seats for the new superman movie" }, defaultCtx),
    ).resolves.toBe("browser");
    expect(classifyWithLlm).toHaveBeenCalledOnce();
  });

  it("trusts the LLM verdict even when keywords disagree", async () => {
    const classifyWithLlm = vi.fn().mockResolvedValue("chat");
    const router = makeRouter({ classifyWithLlm });
    await expect(
      router.route({ prompt: "what does the notepad app do?" }, defaultCtx),
    ).resolves.toBeUndefined();
  });

  it("falls back to heuristics when the LLM classifier fails", async () => {
    const classifyWithLlm = vi.fn().mockRejectedValue(new Error("boom"));
    const router = makeRouter({ classifyWithLlm });
    await expect(router.route({ prompt: "hello there" }, defaultCtx)).resolves.toBeUndefined();
    await expect(
      router.route(
        { prompt: "open notepad and type hi" },
        { ...defaultCtx, sessionKey: "s-fallback" },
      ),
    ).resolves.toBe("desktop");
  });
});

describe("sticky persistence", () => {
  it("saves sticky routes and restores them in a new router instance", async () => {
    let persisted: Record<string, StickyEntry> = {};
    const stickyStore = {
      load: () => persisted,
      save: (entries: typeof persisted) => {
        persisted = entries;
      },
    };
    const first = makeRouter({ stickyStore });
    await expect(first.route({ prompt: "open notepad and type hi" }, defaultCtx)).resolves.toBe(
      "desktop",
    );
    expect(persisted[defaultCtx.sessionKey]?.route).toBe("desktop");

    // Simulate a gateway restart: a fresh router loads the persisted state,
    // so a chat-classified follow-up still rides the automation model.
    const second = makeRouter({ stickyStore });
    await expect(second.route({ prompt: "yes, continue" }, defaultCtx)).resolves.toBe("desktop");
  });

  it("drops expired entries on load", async () => {
    const stickyStore = {
      load: () => ({ [defaultCtx.sessionKey]: { route: "desktop" as const, expiresAt: 1000 } }),
      save: () => {},
    };
    const router = makeRouter({ stickyStore, now: () => 2000 });
    await expect(router.route({ prompt: "yes, continue" }, defaultCtx)).resolves.toBeUndefined();
  });
});

describe("readTaskRouterConfig", () => {
  it("applies defaults and trims strings", () => {
    expect(readTaskRouterConfig(undefined)).toEqual({
      browserModel: undefined,
      desktopModel: undefined,
      classifierModel: undefined,
      stickyMinutes: 30,
    });
    expect(
      readTaskRouterConfig({
        browserModel: " together/moonshotai/Kimi-K2.6 ",
        stickyMinutes: 0,
      }),
    ).toEqual({
      browserModel: "together/moonshotai/Kimi-K2.6",
      desktopModel: undefined,
      classifierModel: undefined,
      stickyMinutes: 0,
    });
  });
});

describe("resolveRouteModelRef", () => {
  it("falls back across browser/desktop models", () => {
    expect(
      resolveRouteModelRef({ browserModel: "a/b", stickyMinutes: 30 }, "desktop"),
    ).toBe("a/b");
    expect(
      resolveRouteModelRef({ desktopModel: "c/d", stickyMinutes: 30 }, "browser"),
    ).toBe("c/d");
  });
});
