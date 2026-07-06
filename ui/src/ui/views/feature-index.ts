import type { IconName } from "../icons.ts";
import type { Tab } from "../navigation.ts";
import { normalizeLowercaseStringOrEmpty } from "../string-coerce.ts";

// ── Feature index ──────────────────────────────────────────────────────
// A plain-language catalog of everything the dashboard can do, so anyone
// can find a feature by typing what they want ("whatsapp", "api key",
// "schedule", "costs"…) without knowing where it lives. Powers the ⌘K
// command palette / feature search.

export type FeatureEntry = {
  id: string;
  /** Short display name. */
  label: string;
  /** One-line, jargon-free explanation of what this does. */
  description: string;
  /** Synonyms and words people actually type. */
  keywords: string[];
  icon: IconName;
  /** "page" = a whole tab; "feature" = a task/setting that lives on a tab. */
  kind: "page" | "feature";
  /** The tab this navigates to. */
  tab: Tab;
};

const PAGES: FeatureEntry[] = [
  {
    id: "page-chat",
    label: "Chat",
    description: "Talk to your AI assistant directly from the browser.",
    keywords: ["talk", "message", "conversation", "prompt", "ask", "voice"],
    icon: "messageSquare",
    kind: "page",
    tab: "chat",
  },
  {
    id: "page-overview",
    label: "Overview",
    description: "Health check: is everything running, and how to connect.",
    keywords: ["home", "dashboard", "status", "health", "gateway", "connect", "update"],
    icon: "barChart",
    kind: "page",
    tab: "overview",
  },
  {
    id: "page-world",
    label: "World",
    description: "A little 2D world where your agents live — watch them work.",
    keywords: ["2d", "office", "map", "avatars", "characters", "pixel", "game", "watch", "roam"],
    icon: "globe",
    kind: "page",
    tab: "world",
  },
  {
    id: "page-agents",
    label: "Agents",
    description: "Your AI workers — each with its own name, model, tools and files.",
    keywords: ["workers", "assistants", "bots", "team", "identity", "workspace"],
    icon: "folder",
    kind: "page",
    tab: "agents",
  },
  {
    id: "page-channels",
    label: "Channels",
    description: "Link WhatsApp, Telegram, Discord and more, so you can text your AI.",
    keywords: ["whatsapp", "telegram", "discord", "signal", "slack", "imessage", "messaging"],
    icon: "link",
    kind: "page",
    tab: "channels",
  },
  {
    id: "page-sessions",
    label: "Sessions",
    description: "Past and active conversations — continue, reset or clean them up.",
    keywords: ["conversations", "history", "context", "threads", "reset"],
    icon: "fileText",
    kind: "page",
    tab: "sessions",
  },
  {
    id: "page-usage",
    label: "Usage",
    description: "What your AI costs: tokens, requests and dollars over time.",
    keywords: ["cost", "costs", "spend", "billing", "tokens", "money", "price", "budget"],
    icon: "barChart",
    kind: "page",
    tab: "usage",
  },
  {
    id: "page-cron",
    label: "Cron Jobs",
    description: "Things that run on a schedule — reminders, reports, recurring tasks.",
    keywords: ["schedule", "scheduled", "recurring", "timer", "reminder", "daily", "automation"],
    icon: "loader",
    kind: "page",
    tab: "cron",
  },
  {
    id: "page-skills",
    label: "Skills",
    description: "Add-on abilities for your agents — like installing apps on a phone.",
    keywords: ["abilities", "plugins", "addons", "install", "clawhub", "capabilities"],
    icon: "zap",
    kind: "page",
    tab: "skills",
  },
  {
    id: "page-nodes",
    label: "Nodes",
    description: "Other devices (phone, laptop) your AI can reach: camera, screen, exec.",
    keywords: ["devices", "pair", "pairing", "phone", "camera", "screen", "remote"],
    icon: "monitor",
    kind: "page",
    tab: "nodes",
  },
  {
    id: "page-instances",
    label: "Instances",
    description: "Apps and clients currently connected to your gateway.",
    keywords: ["connected", "clients", "presence", "online"],
    icon: "radio",
    kind: "page",
    tab: "instances",
  },
  {
    id: "page-dreams",
    label: "Dreaming",
    description: "Your AI tidies and consolidates its memory while idle.",
    keywords: ["memory", "sleep", "consolidation", "reflection", "diary"],
    icon: "moon",
    kind: "page",
    tab: "dreams",
  },
  {
    id: "page-providers",
    label: "API Keys",
    description: "Connect AI model providers (Anthropic, OpenAI, Ollama…) with keys.",
    keywords: ["api key", "anthropic", "openai", "openrouter", "ollama", "gemini", "provider", "models", "brain"],
    icon: "zap",
    kind: "page",
    tab: "providers",
  },
  {
    id: "page-config",
    label: "Config",
    description: "Edit the raw openclaw.json settings file (advanced).",
    keywords: ["settings", "json", "raw", "advanced", "openclaw.json", "file"],
    icon: "settings",
    kind: "page",
    tab: "config",
  },
  {
    id: "page-communications",
    label: "Communications",
    description: "How your AI messages and speaks: channels, broadcast, voice, audio.",
    keywords: ["voice", "tts", "speech", "talk", "audio", "broadcast", "messages"],
    icon: "send",
    kind: "page",
    tab: "communications",
  },
  {
    id: "page-appearance",
    label: "Appearance",
    description: "Make it yours: theme, interface options and the setup wizard.",
    keywords: ["theme", "dark mode", "light mode", "ui", "colors", "wizard", "language"],
    icon: "spark",
    kind: "page",
    tab: "appearance",
  },
  {
    id: "page-automation",
    label: "Automation",
    description: "Commands, hooks, schedules and approvals that run on their own.",
    keywords: ["hooks", "commands", "plugins", "approvals", "bindings"],
    icon: "terminal",
    kind: "page",
    tab: "automation",
  },
  {
    id: "page-infrastructure",
    label: "Infrastructure",
    description: "Under the hood: gateway, web access, browser and media settings.",
    keywords: ["gateway", "port", "network", "browser", "media", "mcp", "server"],
    icon: "globe",
    kind: "page",
    tab: "infrastructure",
  },
  {
    id: "page-ai-agents",
    label: "AI & Agents",
    description: "Brains and behavior: default models, tools, skills, memory, sessions.",
    keywords: ["model", "models", "tools", "memory", "session", "defaults"],
    icon: "brain",
    kind: "page",
    tab: "aiAgents",
  },
  {
    id: "page-debug",
    label: "Debug",
    description: "Inspect what is happening inside the gateway (snapshots, events, RPC).",
    keywords: ["inspect", "rpc", "events", "snapshot", "troubleshoot"],
    icon: "bug",
    kind: "page",
    tab: "debug",
  },
  {
    id: "page-logs",
    label: "Logs",
    description: "Live feed of what the system is doing — useful when something breaks.",
    keywords: ["errors", "console", "output", "tail", "troubleshoot"],
    icon: "scrollText",
    kind: "page",
    tab: "logs",
  },
];

const FEATURES: FeatureEntry[] = [
  {
    id: "feat-whatsapp",
    label: "Connect WhatsApp",
    description: "Scan a QR code so your AI answers on WhatsApp.",
    keywords: ["whatsapp", "qr", "link phone", "wa"],
    icon: "link",
    kind: "feature",
    tab: "channels",
  },
  {
    id: "feat-telegram",
    label: "Connect Telegram",
    description: "Add a Telegram bot token so your AI answers on Telegram.",
    keywords: ["telegram", "bot", "token"],
    icon: "link",
    kind: "feature",
    tab: "channels",
  },
  {
    id: "feat-discord",
    label: "Connect Discord",
    description: "Let your AI join and reply in your Discord server.",
    keywords: ["discord", "server", "bot"],
    icon: "link",
    kind: "feature",
    tab: "channels",
  },
  {
    id: "feat-signal-imessage",
    label: "Connect Signal / iMessage / Slack",
    description: "Link more messaging apps to your AI.",
    keywords: ["signal", "imessage", "slack", "google chat", "nostr", "messaging"],
    icon: "link",
    kind: "feature",
    tab: "channels",
  },
  {
    id: "feat-add-api-key",
    label: "Add an API key",
    description: "Paste a provider key (Anthropic, OpenAI…) so models can run.",
    keywords: ["api key", "secret", "credentials", "anthropic", "openai", "openrouter", "together"],
    icon: "plus",
    kind: "feature",
    tab: "providers",
  },
  {
    id: "feat-local-models",
    label: "Use local models (Ollama)",
    description: "Run free models on your own machine — no API key needed.",
    keywords: ["ollama", "local", "free", "offline", "llama"],
    icon: "monitor",
    kind: "feature",
    tab: "providers",
  },
  {
    id: "feat-default-model",
    label: "Change the default model",
    description: "Pick which AI model answers by default (and fallbacks).",
    keywords: ["model", "switch model", "default", "fallback", "kimi", "claude", "gpt"],
    icon: "brain",
    kind: "feature",
    tab: "aiAgents",
  },
  {
    id: "feat-create-agent",
    label: "Create a new agent",
    description: "Add a specialist AI worker with its own purpose, tools and model.",
    keywords: ["new agent", "add agent", "wizard", "specialist", "assistant"],
    icon: "plus",
    kind: "feature",
    tab: "agents",
  },
  {
    id: "feat-agent-tools",
    label: "Control what an agent may do",
    description: "Allow or deny tools (browser, shell, files…) per agent.",
    keywords: ["tools", "permissions", "allow", "deny", "safety", "sandbox"],
    icon: "wrench",
    kind: "feature",
    tab: "agents",
  },
  {
    id: "feat-agent-files",
    label: "Edit an agent's instructions",
    description: "Change the AGENTS.md and memory files that shape behavior.",
    keywords: ["instructions", "prompt", "personality", "agents.md", "memory", "files"],
    icon: "fileCode",
    kind: "feature",
    tab: "agents",
  },
  {
    id: "feat-schedule",
    label: "Schedule a recurring task",
    description: "Make the AI do something every morning, hour or week.",
    keywords: ["schedule", "cron", "every day", "reminder", "recurring", "weekly", "wakeup"],
    icon: "loader",
    kind: "feature",
    tab: "cron",
  },
  {
    id: "feat-install-skill",
    label: "Install a skill",
    description: "Browse ClawHub and add new abilities to your agents.",
    keywords: ["install", "clawhub", "skill", "ability", "plugin", "marketplace"],
    icon: "download",
    kind: "feature",
    tab: "skills",
  },
  {
    id: "feat-pair-device",
    label: "Pair a device",
    description: "Add your phone or another computer as a node your AI can use.",
    keywords: ["pair", "device", "phone", "node", "camera", "screen capture"],
    icon: "smartphone",
    kind: "feature",
    tab: "nodes",
  },
  {
    id: "feat-costs",
    label: "See what your AI costs",
    description: "Token and dollar usage per day, model and session.",
    keywords: ["cost", "spend", "bill", "tokens", "how much", "money"],
    icon: "barChart",
    kind: "feature",
    tab: "usage",
  },
  {
    id: "feat-watch-agents",
    label: "Watch your agents work",
    description: "Open the 2D world, click an agent, give it a task and watch live.",
    keywords: ["watch", "world", "live", "office", "avatars", "fun"],
    icon: "globe",
    kind: "feature",
    tab: "world",
  },
  {
    id: "feat-voice",
    label: "Voice & speech settings",
    description: "Let your AI talk out loud and pick its voice (TTS).",
    keywords: ["voice", "tts", "speak", "talk mode", "speech", "audio", "microphone"],
    icon: "mic",
    kind: "feature",
    tab: "communications",
  },
  {
    id: "feat-theme",
    label: "Switch dark / light theme",
    description: "Change how the dashboard looks.",
    keywords: ["dark", "light", "theme", "appearance", "color"],
    icon: "sun",
    kind: "feature",
    tab: "appearance",
  },
  {
    id: "feat-language",
    label: "Change dashboard language",
    description: "Use the dashboard in English, Spanish, Japanese and more.",
    keywords: ["language", "locale", "translation", "english", "spanish"],
    icon: "globe",
    kind: "feature",
    tab: "appearance",
  },
  {
    id: "feat-reset-session",
    label: "Reset a conversation",
    description: "Start fresh when a chat gets too long or confused.",
    keywords: ["reset", "clear", "new session", "start over", "context"],
    icon: "refresh",
    kind: "feature",
    tab: "sessions",
  },
  {
    id: "feat-exec-approvals",
    label: "Command approvals & allowlist",
    description: "Decide which shell commands agents may run without asking.",
    keywords: ["approvals", "allowlist", "exec", "shell", "safety", "permissions"],
    icon: "check",
    kind: "feature",
    tab: "automation",
  },
  {
    id: "feat-dreaming-toggle",
    label: "Turn memory dreaming on/off",
    description: "Let the AI organize its memories while idle — or stop it.",
    keywords: ["dreaming", "memory", "consolidate", "idle", "sleep"],
    icon: "moon",
    kind: "feature",
    tab: "dreams",
  },
  {
    id: "feat-update",
    label: "Update OpenClaw",
    description: "Check your version and install the latest release.",
    keywords: ["update", "upgrade", "version", "new release"],
    icon: "download",
    kind: "feature",
    tab: "overview",
  },
  {
    id: "feat-gateway-access",
    label: "Gateway access & tokens",
    description: "Where the dashboard connects and how it authenticates.",
    keywords: ["token", "password", "auth", "url", "websocket", "connect"],
    icon: "plug",
    kind: "feature",
    tab: "overview",
  },
  {
    id: "feat-live-logs",
    label: "Watch live logs",
    description: "See everything the gateway does, as it happens.",
    keywords: ["logs", "errors", "live", "tail", "debugging"],
    icon: "scrollText",
    kind: "feature",
    tab: "logs",
  },
];

export const FEATURE_INDEX: FeatureEntry[] = [...PAGES, ...FEATURES];

/**
 * Rank an entry against pre-normalized query tokens.
 * Every token must match somewhere (label, keywords or description);
 * the score rewards label prefixes strongest so exact page names win.
 */
export function scoreFeature(entry: FeatureEntry, tokens: string[]): number {
  const label = normalizeLowercaseStringOrEmpty(entry.label);
  const description = normalizeLowercaseStringOrEmpty(entry.description);
  const keywords = entry.keywords.map((k) => normalizeLowercaseStringOrEmpty(k));
  let total = 0;
  for (const token of tokens) {
    let best = 0;
    if (label.startsWith(token)) {
      best = 100;
    } else if (label.includes(token)) {
      best = 60;
    }
    for (const keyword of keywords) {
      if (keyword.startsWith(token)) {
        best = Math.max(best, 50);
      } else if (keyword.includes(token)) {
        best = Math.max(best, 35);
      }
    }
    if (best === 0 && description.includes(token)) {
      best = 20;
    }
    if (best === 0) {
      return 0; // every token must match
    }
    total += best;
  }
  // Small tie-breaker: pages above features.
  return total + (entry.kind === "page" ? 2 : 0);
}

export function searchFeatures(query: string, limit = 40): FeatureEntry[] {
  const q = normalizeLowercaseStringOrEmpty(query).trim();
  if (!q) {
    return FEATURE_INDEX.slice(0, limit);
  }
  const tokens = q.split(/\s+/).filter(Boolean);
  return FEATURE_INDEX.map((entry) => ({ entry, score: scoreFeature(entry, tokens) }))
    .filter((item) => item.score > 0)
    .toSorted((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.entry);
}
