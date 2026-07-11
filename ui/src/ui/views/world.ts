import { html, nothing } from "lit";
import type { GatewayAgentRow } from "../types.ts";
import "../components/world-stage.ts";
import { agentDisplayName, agentModelLabel, spriteArtFor } from "../components/world-stage.ts";

// ── 2D agent world ─────────────────────────────────────────────────────
// A living top-down pixel world (rendered by <world-stage>) where each
// agent roams as a character: idle agents wander, take breaks and chat;
// the working agent sits at its desk and types. Click an agent to open a
// side panel with its live feed and a prompt box.

/** Render an agent's face (animated sprite) for the side panel. */
function renderPanelFace(agent: GatewayAgentRow, basePath: string) {
  const art = spriteArtFor(agent.id || agentDisplayName(agent), basePath);
  return html`
    <span
      class="sprite-char sprite-char--lg"
      style=${`background-image:url('${art.url}');--hue:${art.hue}deg`}
    ></span>
  `;
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
  /** All agents with a run in flight right now (chat, cron, channels…). */
  workingAgentIds: string[];
  /** Streaming assistant text for the active run, if any. */
  liveText: string | null;
  /** Recent compact activity entries for the active agent. */
  liveMessages: WorldFeedEntry[];
  /** Current value of the world prompt box. */
  promptValue: string;
  /** Selected environment theme id (office | forest | void). */
  theme: string;
  onThemeChange: (theme: string) => void;
  onSelect: (agentId: string) => void;
  onClosePanel: () => void;
  onPromptInput: (value: string) => void;
  onSend: () => void;
  onOpenChat: () => void;
  onOpenAgents: () => void;
  onReload: () => void;
};

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
  const working =
    (props.activeAgentId === agent.id && props.busy) ||
    props.workingAgentIds.includes(agent.id);
  const canSend = props.promptValue.trim().length > 0 && !working;
  return html`
    <aside class="world-panel">
      <header class="world-panel-head">
        <span class="world-panel-face">${renderPanelFace(agent, props.basePath)}</span>
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
        <p class="world-empty-title">No agents live here yet.</p>
        <p class="world-empty-sub">
          Agents are your AI workers — each becomes a little character that lives in this world.
          Create one and it moves in.
        </p>
        <div class="world-empty-actions">
          <button class="world-send" @click=${props.onOpenAgents}>Create an agent</button>
          <button class="world-open-chat" @click=${props.onReload}>Refresh</button>
        </div>
      </div>
    `;
  }
  const panelOpen = Boolean(props.selectedAgentId);
  const chatWorkingAgentId = props.busy ? props.activeAgentId : null;
  const workingAgentIds = [
    ...new Set([...props.workingAgentIds, ...(chatWorkingAgentId ? [chatWorkingAgentId] : [])]),
  ];
  return html`
    <div class="world ${panelOpen ? "has-panel" : ""}">
      <world-stage
        .agents=${props.agents}
        .theme=${props.theme}
        .basePath=${props.basePath}
        .workingAgentIds=${workingAgentIds}
        .selectedAgentId=${props.selectedAgentId}
        .liveSnippet=${props.liveText}
        .liveSnippetAgentId=${chatWorkingAgentId}
        .onAgentSelect=${(agentId: string) => props.onSelect(agentId)}
        .onThemeChange=${(theme: string) => props.onThemeChange(theme)}
        .onStageClick=${() => props.onClosePanel()}
      ></world-stage>
      ${panelOpen ? renderPanel(props) : nothing}
    </div>
  `;
}
