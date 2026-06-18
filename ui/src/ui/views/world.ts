import { html, nothing } from "lit";
import type { GatewayAgentRow } from "../types.ts";

// ── 2D office world ────────────────────────────────────────────────────
// A top-down view of an office where each agent is a wandering avatar.
// Click an agent to open a side panel: see what it's working on (live feed)
// and give it a task. Sending routes the prompt to that agent's session and
// the avatar lights up while it works.

// CC0 pixel character sprite sheets (Ninja Adventure pack by Pixel-Boy, CC0 —
// free for commercial use, no attribution required), bundled under /sprites.
// Each sheet is a 4×7 grid of 16px frames; the top row is the front-facing
// walk cycle (4 frames) which we animate. Per-agent we pick a base sheet and a
// hue rotation so every agent is visually distinct but stable.
const SPRITE_BASES = ["ninja_blue", "samurai_blue", "samurai_green"];
const SPRITE_HUES = [0, 35, 70, 140, 200, 250, 300];

function hashString(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) {
    h = (h * 31 + value.charCodeAt(i)) >>> 0;
  }
  return h;
}

function agentDisplayName(agent: GatewayAgentRow): string {
  return (agent.name || agent.identity?.name || agent.id || "agent").trim();
}

/** Render an agent as an animated CC0 pixel sprite, distinct + stable per id. */
function renderPixelChar(agent: GatewayAgentRow, basePath: string, large = false) {
  const h = hashString(agent.id || agentDisplayName(agent));
  const base = SPRITE_BASES[h % SPRITE_BASES.length];
  const hue = SPRITE_HUES[(h >> 4) % SPRITE_HUES.length];
  const root = (basePath || "").replace(/\/$/, "");
  const url = `${root}/sprites/${base}.png`;
  return html`
    <span
      class="sprite-char ${large ? "sprite-char--lg" : ""}"
      style=${`background-image:url('${url}');--hue:${hue}deg`}
    ></span>
  `;
}

function agentModelLabel(agent: GatewayAgentRow): string {
  const primary = agent.model?.primary?.trim();
  if (!primary) {
    return "default model";
  }
  // Shorten "together/moonshotai/Kimi-K2.6" → "Kimi-K2.6".
  const parts = primary.split("/");
  return parts[parts.length - 1] || primary;
}

export type WorldFeedEntry = {
  role: string;
  text: string;
};

export type WorldProps = {
  agents: GatewayAgentRow[];
  loading: boolean;
  basePath: string;
  /** Agent the chat session currently targets (its live data belongs to this one). */
  activeAgentId: string | null;
  /** Agent the user has selected in the world (opens the side panel). */
  selectedAgentId: string | null;
  /** True while the active agent has a run in flight. */
  busy: boolean;
  /** Streaming assistant text for the active run, if any. */
  liveText: string | null;
  /** Recent compact activity entries for the active agent. */
  liveMessages: WorldFeedEntry[];
  /** Current value of the world prompt box. */
  promptValue: string;
  onSelect: (agentId: string) => void;
  onClosePanel: () => void;
  onPromptInput: (value: string) => void;
  onSend: () => void;
  onOpenChat: () => void;
  onReload: () => void;
};

function renderAvatar(agent: GatewayAgentRow, props: WorldProps, index: number) {
  const working = props.activeAgentId === agent.id && props.busy;
  const selected = props.selectedAgentId === agent.id;
  const seed = hashString(agent.id || String(index));
  // Stable per-agent animation timing so they wander out of sync.
  const wanderDur = 14 + (seed % 9); // 14–22s
  const wanderDelay = (seed >> 3) % 6; // 0–5s
  const bobDur = 2.6 + ((seed >> 5) % 12) / 10; // 2.6–3.8s
  const classes = [
    "world-agent",
    working ? "is-working" : "is-idle",
    selected ? "is-selected" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return html`
    <button
      class=${classes}
      style=${`--wander-dur:${wanderDur}s;--wander-delay:${wanderDelay}s;--bob-dur:${bobDur}s`}
      title=${`${agentDisplayName(agent)} — ${working ? "working" : "idle"}`}
      @click=${() => props.onSelect(agent.id)}
    >
      <span class="world-desk"></span>
      <span class="world-agent-puck">
        <span class="world-agent-ring"></span>
        ${renderPixelChar(agent, props.basePath)}
        ${working ? html`<span class="world-agent-think">💭</span>` : nothing}
      </span>
      <span class="world-agent-label">
        <span class="world-agent-name">${agentDisplayName(agent)}</span>
        <span class="world-agent-status">${working ? "working…" : "idle"}</span>
      </span>
    </button>
  `;
}

function renderFeed(props: WorldProps, name: string) {
  const showLive = props.selectedAgentId === props.activeAgentId;
  if (!showLive || (!props.busy && !props.liveText && props.liveMessages.length === 0)) {
    return html`<p class="world-feed-empty">
      ${name} is idle. Give it a task below and watch it work here.
    </p>`;
  }
  const entries = props.liveMessages.slice(-6);
  return html`
    <div class="world-feed">
      ${entries.map(
        (entry) => html`
          <div class="world-feed-row ${entry.role}">
            <span class="world-feed-role">${entry.role}</span>
            <span class="world-feed-text">${entry.text}</span>
          </div>
        `,
      )}
      ${props.liveText
        ? html`<div class="world-feed-row stream">
            <span class="world-feed-role">live</span>
            <span class="world-feed-text">${props.liveText}</span>
          </div>`
        : nothing}
      ${props.busy
        ? html`<div class="world-feed-working"><span class="world-dot"></span> working…</div>`
        : nothing}
    </div>
  `;
}

function renderPanel(props: WorldProps) {
  const agent = props.agents.find((a) => a.id === props.selectedAgentId);
  if (!agent) {
    return nothing;
  }
  const name = agentDisplayName(agent);
  const working = props.activeAgentId === agent.id && props.busy;
  const canSend = props.promptValue.trim().length > 0 && !working;
  return html`
    <aside class="world-panel">
      <header class="world-panel-head">
        <span class="world-panel-face">${renderPixelChar(agent, props.basePath, true)}</span>
        <span class="world-panel-id">
          <span class="world-panel-name">${name}</span>
          <span class="world-panel-model">${agentModelLabel(agent)}</span>
        </span>
        <span class="world-panel-state ${working ? "on" : ""}">
          ${working ? "● Working" : "○ Idle"}
        </span>
        <button class="world-panel-close" @click=${props.onClosePanel} title="Close">×</button>
      </header>
      <div class="world-panel-body">${renderFeed(props, name)}</div>
      <div class="world-panel-compose">
        <textarea
          class="world-compose-input"
          rows="3"
          placeholder=${`Tell ${name} what to do…`}
          .value=${props.promptValue}
          @input=${(e: Event) => props.onPromptInput((e.target as HTMLTextAreaElement).value)}
          @keydown=${(e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canSend) {
              e.preventDefault();
              props.onSend();
            }
          }}
        ></textarea>
        <div class="world-compose-row">
          <button class="world-send" ?disabled=${!canSend} @click=${props.onSend}>
            Send &amp; watch
          </button>
          <button class="world-open-chat" @click=${props.onOpenChat}>Open full chat ↗</button>
        </div>
      </div>
    </aside>
  `;
}

export function renderWorld(props: WorldProps) {
  if (props.loading && props.agents.length === 0) {
    return html`<div class="world-empty"><span class="world-dot"></span> Loading your agents…</div>`;
  }
  if (props.agents.length === 0) {
    return html`
      <div class="world-empty">
        <p>No agents live here yet.</p>
        <p class="world-empty-sub">
          Create one in the <strong>Agents</strong> tab, or just ask in chat
          (“create an agent that…”) and it’ll move in here.
        </p>
        <button class="world-open-chat" @click=${props.onReload}>Refresh</button>
      </div>
    `;
  }
  const panelOpen = Boolean(props.selectedAgentId);
  return html`
    <div class="world ${panelOpen ? "has-panel" : ""}">
      <div class="world-stage" @click=${(e: Event) => {
        // Click on empty floor closes the panel.
        if ((e.target as HTMLElement).classList.contains("world-stage")) {
          props.onClosePanel();
        }
      }}>
        <div class="world-floor"></div>
        <div class="world-agents">
          ${props.agents.map((agent, i) => renderAvatar(agent, props, i))}
        </div>
      </div>
      ${panelOpen ? renderPanel(props) : nothing}
    </div>
  `;
}
