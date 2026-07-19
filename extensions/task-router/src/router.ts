import { classifyTaskHeuristic, type TaskKind } from "./classify.js";

export type TaskRoute = "browser" | "desktop" | "chat";

export type TaskRouterConfig = {
  browserModel?: string;
  desktopModel?: string;
  /** Cheap model for chat-classified runs (questions, conversation, writing). */
  chatModel?: string;
  /** Tiny model that answers trivial social messages without running the agent. */
  liteModel?: string;
  classifierModel?: string;
  stickyMinutes: number;
};

export const DEFAULT_STICKY_MINUTES = 30;

export function readTaskRouterConfig(raw: Record<string, unknown> | undefined): TaskRouterConfig {
  const cfg = raw ?? {};
  const readString = (key: string): string | undefined => {
    const value = cfg[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  };
  const stickyRaw = cfg.stickyMinutes;
  const stickyMinutes =
    typeof stickyRaw === "number" && Number.isFinite(stickyRaw) && stickyRaw >= 0
      ? stickyRaw
      : DEFAULT_STICKY_MINUTES;
  return {
    browserModel: readString("browserModel"),
    desktopModel: readString("desktopModel"),
    chatModel: readString("chatModel"),
    liteModel: readString("liteModel"),
    classifierModel: readString("classifierModel"),
    stickyMinutes,
  };
}

export function resolveRouteModelRef(
  config: TaskRouterConfig,
  route: TaskRoute,
): string | undefined {
  if (route === "chat") {
    return config.chatModel;
  }
  if (route === "desktop") {
    return config.desktopModel ?? config.browserModel;
  }
  return config.browserModel ?? config.desktopModel;
}

export type TaskRouteEvent = {
  prompt: string;
};

export type TaskRouteContext = {
  sessionKey?: string;
  agentId?: string;
  /** Provider already resolved for this run (session override or agent default). */
  modelProviderId?: string;
  /** Model already resolved for this run (session override or agent default). */
  modelId?: string;
  trigger?: string;
};

export type StickyEntry = { route: TaskRoute; expiresAt: number };

export type StickyStore = {
  load: () => Record<string, StickyEntry> | undefined;
  save: (entries: Record<string, StickyEntry>) => void;
};

export type TaskRouterDeps = {
  config: TaskRouterConfig;
  /** Normalized "provider/model" the agent would use with no session override. */
  resolveDefaultModelRef: (agentId: string | undefined) => string | undefined;
  /**
   * Primary classifier: a small LLM that generalizes to any phrasing/task.
   * Keyword heuristics only run when this is unset, fails, or can't decide.
   */
  classifyWithLlm?: (prompt: string) => Promise<TaskKind | null>;
  /** Optional persistence so sticky routes survive gateway restarts. */
  stickyStore?: StickyStore;
  log?: (message: string) => void;
  now?: () => number;
};

export type TaskRouter = {
  route: (event: TaskRouteEvent, ctx: TaskRouteContext) => Promise<TaskRoute | undefined>;
};

export function createTaskRouter(deps: TaskRouterDeps): TaskRouter {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => {});
  const sticky = new Map<string, StickyEntry>();
  const stickyMs = deps.config.stickyMinutes * 60_000;

  if (deps.stickyStore && stickyMs > 0) {
    try {
      const loaded = deps.stickyStore.load();
      if (loaded) {
        for (const [key, entry] of Object.entries(loaded)) {
          if (
            (entry.route === "browser" || entry.route === "desktop") &&
            typeof entry.expiresAt === "number" &&
            entry.expiresAt > now()
          ) {
            sticky.set(key, entry);
          }
        }
      }
    } catch (err) {
      log(`task-router: failed to load sticky state: ${String(err)}`);
    }
  }

  const persistSticky = () => {
    if (!deps.stickyStore) {
      return;
    }
    try {
      deps.stickyStore.save(Object.fromEntries(sticky));
    } catch (err) {
      log(`task-router: failed to save sticky state: ${String(err)}`);
    }
  };

  const readSticky = (sessionKey: string | undefined): TaskRoute | undefined => {
    if (!sessionKey || stickyMs <= 0) {
      return undefined;
    }
    const entry = sticky.get(sessionKey);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt <= now()) {
      sticky.delete(sessionKey);
      return undefined;
    }
    return entry.route;
  };

  const writeSticky = (sessionKey: string | undefined, route: TaskRoute) => {
    if (!sessionKey || stickyMs <= 0) {
      return;
    }
    sticky.set(sessionKey, { route, expiresAt: now() + stickyMs });
    persistSticky();
  };

  return {
    async route(event, ctx) {
      // Only reroute user-initiated runs; heartbeats/cron keep their own models.
      if (ctx.trigger && ctx.trigger !== "user") {
        return undefined;
      }

      // Respect manual model selection: when the session already resolves to a
      // model other than the agent default, the user picked it on purpose.
      const defaultRef = deps.resolveDefaultModelRef(ctx.agentId)?.toLowerCase();
      const currentRef =
        ctx.modelProviderId && ctx.modelId
          ? `${ctx.modelProviderId}/${ctx.modelId}`.toLowerCase()
          : undefined;
      if (defaultRef && currentRef && defaultRef !== currentRef) {
        if (ctx.sessionKey && sticky.delete(ctx.sessionKey)) {
          persistSticky();
        }
        return undefined;
      }

      let kind: TaskKind | null = null;
      if (deps.classifyWithLlm) {
        try {
          kind = await deps.classifyWithLlm(event.prompt);
        } catch (err) {
          log(`task-router: LLM classification failed: ${String(err)}`);
          kind = null;
        }
      }
      if (kind === null || kind === "unknown") {
        kind = classifyTaskHeuristic(event.prompt);
      }

      if (kind === "browser" || kind === "desktop") {
        writeSticky(ctx.sessionKey, kind);
        return kind;
      }

      // Mid-task follow-ups ("yes, continue", "use my other account") classify
      // as chat but still belong to the automation task — keep the routed model
      // and refresh the window so long tasks never lose it between steps. The
      // window only lapses after stickyMinutes of session inactivity.
      const stickyRoute = readSticky(ctx.sessionKey);
      if (stickyRoute) {
        writeSticky(ctx.sessionKey, stickyRoute);
        return stickyRoute;
      }

      // No automation in flight: pure conversation can run on the cheap chat
      // model. Never sticky — the next message re-classifies from scratch.
      if (kind === "chat" && deps.config.chatModel) {
        return "chat";
      }
      return undefined;
    },
  };
}
