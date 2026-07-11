import { html, LitElement, nothing } from "lit";
import { property, state } from "lit/decorators.js";
import type { GatewayAgentRow } from "../types.ts";

// ── World stage ────────────────────────────────────────────────────────
// A living top-down pixel world. Each agent is a sprite that freely roams
// the map: idle agents wander between points of interest, pause, chat with
// each other and think out loud; the working agent walks to its desk and
// types. The simulation ticks inside this element (~1.7 Hz) so the rest of
// the app never re-renders for animation.
//
// The world GROWS with the team: desks are laid out on a grid sized to the
// agent count, so every agent gets its own workstation and the map expands
// (and the viewport scrolls) as more agents move in.
//
// Sprites are CC0 (Ninja Adventure pack). Sheets are 4 columns × 7 rows of
// 16px frames; COLUMNS are facing directions (down, up, left, right) and
// the first four ROWS are the walk-cycle frames for that direction.

const SPRITE_BASES = ["ninja_blue", "samurai_blue", "samurai_green"];
const SPRITE_HUES = [0, 35, 70, 140, 200, 250, 300];

export function hashString(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) {
    h = (h * 31 + value.charCodeAt(i)) >>> 0;
  }
  return h;
}

export function spriteArtFor(agentKey: string, basePath: string): { url: string; hue: number } {
  const h = hashString(agentKey);
  const base = SPRITE_BASES[h % SPRITE_BASES.length];
  const hue = SPRITE_HUES[(h >> 4) % SPRITE_HUES.length];
  const root = (basePath || "").replace(/\/$/, "");
  return { url: `${root}/sprites/${base}.png`, hue };
}

export function agentDisplayName(agent: GatewayAgentRow): string {
  return (agent.name || agent.identity?.name || agent.id || "agent").trim();
}

/** Shorten "together/moonshotai/Kimi-K2.6" → "Kimi-K2.6". */
export function agentModelLabel(agent: GatewayAgentRow): string {
  const primary = agent.model?.primary?.trim();
  if (!primary) {
    return "default model";
  }
  const parts = primary.split("/");
  return parts[parts.length - 1] || primary;
}

// Facing → sprite sheet column.
const FACE_DOWN = 0;
const FACE_UP = 1;
const FACE_LEFT = 2;
const FACE_RIGHT = 3;

type Rect = { x: number; y: number; w: number; h: number };
type Point = { x: number; y: number };
/** A wander target with a meaning ("break", "server", "lounge", "pond"). */
type Poi = { x: number; y: number; kind: string };
type Zone = { x: number; y: number; label: string };
type Prop = { kind: string; x: number; y: number; w: number; deskIdx?: number };

/** A fully resolved, size-aware world (all positions in % of the map). */
type WorldModel = {
  /** Virtual map size in px at base zoom; the render scales this to fit. */
  vw: number;
  vh: number;
  /** Walkable rectangles agents may roam within. */
  walk: Rect[];
  /** No-go areas inside the walk rects (e.g. the forest pond). */
  blocked: Rect[];
  /** One workstation spot per agent; the working agent walks to its own. */
  desks: Point[];
  /** Wander targets so idle motion gravitates to meaningful places. */
  pois: Poi[];
  props: Prop[];
  zones: Zone[];
};

export const WORLD_THEMES: Array<{ id: string; label: string }> = [
  { id: "office", label: "Office" },
  { id: "forest", label: "Forest" },
  { id: "void", label: "Minimal" },
];

// Layout constants (virtual px).
const PAD = 66; // outer margin
const CELL_W = 152; // desk cell width
const CELL_H = 120; // desk cell height
const TOP_BAND = 78; // structures strip above the desks
const BREAK_BAND = 140; // lounge / campfire strip below the desks
const MAX_COLS = 12;

function deskGrid(count: number): { cols: number; rows: number } {
  const n = Math.max(1, count);
  // Aim for a ~16:10 grid so it reads like a room, not a corridor.
  const cols = Math.min(MAX_COLS, Math.max(4, Math.ceil(Math.sqrt(n * 1.7))));
  const rows = Math.max(2, Math.ceil(n / cols));
  return { cols, rows };
}

/** Build the world for a theme + agent count. Deterministic and memoized. */
function buildWorld(theme: string, count: number): WorldModel {
  const forest = theme === "forest";
  const { cols, rows } = deskGrid(count);
  const gridW = cols * CELL_W;
  const gridH = rows * CELL_H;
  const vw = PAD * 2 + gridW;
  const vh = PAD + TOP_BAND + gridH + BREAK_BAND + PAD;
  const px = (v: number) => (v / vw) * 100;
  const py = (v: number) => (v / vh) * 100;
  const wUnits = (widthPx: number) => (widthPx / vw) * 100; // prop width in %-of-width

  const desks: Point[] = [];
  const props: Prop[] = [];
  // Exactly one desk per agent — no empty filler workstations.
  for (let i = 0; i < count; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const cx = PAD + c * CELL_W + CELL_W / 2;
    const standY = PAD + TOP_BAND + r * CELL_H + CELL_H * 0.66;
    desks.push({ x: px(cx), y: py(standY) });
    props.push({
      kind: forest ? "stump" : "desk",
      x: px(cx),
      y: py(standY - 34),
      w: wUnits(forest ? 82 : 96),
      deskIdx: i,
    });
  }

  // Structures along the top strip.
  const topY = PAD + TOP_BAND * 0.42;
  const centerX = vw / 2;
  if (forest) {
    props.push({ kind: "tent", x: px(PAD + CELL_W * 0.5), y: py(topY), w: wUnits(96) });
    props.push({ kind: "tent", x: px(vw - PAD - CELL_W * 0.5), y: py(topY), w: wUnits(88) });
    props.push({ kind: "sign", x: px(PAD * 0.7), y: py(topY + 18), w: wUnits(52) });
    // Frame the clearing with trees along the top edge.
    const treeN = Math.max(4, cols);
    for (let i = 0; i < treeN; i++) {
      const tx = PAD + ((i + 0.5) / treeN) * gridW;
      props.push({ kind: "tree", x: px(tx), y: py(PAD * 0.5), w: wUnits(120) });
    }
  } else {
    props.push({ kind: "whiteboard", x: px(centerX), y: py(topY - 4), w: wUnits(132) });
    props.push({ kind: "bookshelf", x: px(centerX - CELL_W), y: py(topY), w: wUnits(104) });
    props.push({ kind: "clock", x: px(centerX + CELL_W), y: py(topY - 6), w: wUnits(40) });
  }

  // Corner plants (both indoor + a couple in the forest for variety).
  props.push({ kind: "plant", x: px(PAD * 0.6), y: py(PAD + TOP_BAND + 6), w: wUnits(52) });
  props.push({ kind: "plant", x: px(vw - PAD * 0.6), y: py(PAD + TOP_BAND + 6), w: wUnits(52) });

  // Break / lounge strip along the bottom.
  const breakY = vh - PAD - BREAK_BAND * 0.5;
  const pois: Poi[] = [];
  const zones: Zone[] = [];
  const blocked: Rect[] = [];
  if (forest) {
    props.push({ kind: "campfire", x: px(centerX), y: py(breakY), w: wUnits(84) });
    pois.push({ x: px(centerX), y: py(breakY + 6), kind: "break" });
    zones.push({ x: px(centerX), y: py(breakY + BREAK_BAND * 0.42), label: "campfire" });
    // A pond occupies the bottom-right corner (a no-go area).
    const pondX = vw - PAD - 150;
    const pondY = vh - PAD - 96;
    props.push({ kind: "pond", x: px(pondX + 75), y: py(pondY + 44), w: wUnits(180) });
    blocked.push({ x: px(pondX), y: py(pondY - 20), w: wUnits(190), h: (110 / vh) * 100 });
    zones.push({ x: px(pondX + 75), y: py(pondY + 84), label: "pond" });
    pois.push({ x: px(pondX - 20), y: py(pondY + 30), kind: "pond" });
  } else {
    props.push({ kind: "rug", x: px(centerX), y: py(breakY + 8), w: wUnits(190) });
    props.push({ kind: "coffee", x: px(vw - PAD - 40), y: py(breakY - 6), w: wUnits(56) });
    props.push({ kind: "watercooler", x: px(vw - PAD - 96), y: py(breakY + 6), w: wUnits(44) });
    props.push({ kind: "server", x: px(PAD + 30), y: py(breakY), w: wUnits(60) });
    pois.push({ x: px(centerX), y: py(breakY + 6), kind: "lounge" });
    pois.push({ x: px(vw - PAD - 60), y: py(breakY), kind: "break" });
    pois.push({ x: px(PAD + 40), y: py(breakY), kind: "server" });
    zones.push({ x: px(vw - PAD - 70), y: py(breakY + BREAK_BAND * 0.42), label: "break corner" });
    zones.push({ x: px(PAD + 40), y: py(breakY + BREAK_BAND * 0.42), label: "server bay" });
  }
  zones.push({ x: px(centerX), y: py(PAD + TOP_BAND * 0.86), label: "workstations" });

  // A couple of mid-floor wander targets between the desk rows.
  pois.push({ x: px(centerX), y: py(PAD + TOP_BAND + gridH * 0.5), kind: "floor" });

  const walk: Rect[] = [
    {
      x: px(PAD * 0.8),
      y: py(PAD + TOP_BAND * 0.7),
      w: 100 - px(PAD * 0.8) * 2,
      h: 100 - py(PAD + TOP_BAND * 0.7) - py(PAD * 0.8),
    },
  ];

  return { vw, vh, walk, blocked, desks, pois, props, zones };
}

// Idle agents think out loud — but what they say follows where they are
// (break corner, server bay, pond…) and the time of day, so bubbles read
// as behavior, not random noise.
const BUBBLES_BY_PLACE: Record<string, string[]> = {
  break: ["☕ quick break", "refuelling…", "back in a sec"],
  lounge: ["taking five", "stretching…", "thinking it over"],
  server: ["checking the racks", "gateway looks healthy", "all lights green"],
  pond: ["watching the fish", "so calm here", "skipping stones"],
  floor: ["ready for a task", "all quiet", "making the rounds"],
};
const BUBBLES_NIGHT = ["zzz…", "night shift…", "quiet out here"];
const CHAT_OPENERS = [
  "any tasks for me?",
  "how's your context?",
  "logs look clean today",
  "heard we got a new skill",
];
const CHAT_REPLIES = ["all systems green", "plenty of room left", "nice and quiet", "🤖👍"];

// Walk speed in map-height-% per second (x distances are scaled by aspect).
const WALK_SPEED = 13;

type SimAgent = {
  x: number;
  y: number;
  tx: number;
  ty: number;
  moveUntil: number;
  moveDur: number;
  pauseUntil: number;
  facing: number;
  bubble: string | null;
  bubbleUntil: number;
  chatUntil: number;
  chatCooldownUntil: number;
  deskIdx: number;
  /** Meaning of the current destination (POI kind), for contextual bubbles. */
  targetKind: string | null;
};

function pointInRect(x: number, y: number, r: Rect): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

function isWalkable(model: WorldModel, x: number, y: number): boolean {
  if (model.blocked.some((r) => pointInRect(x, y, r))) {
    return false;
  }
  return model.walk.some((r) => pointInRect(x, y, r));
}

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

/** Deterministic 0..1 for stable per-index particle styling. */
function fract(seed: number): number {
  const v = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
}

function dayPhase(date: Date): "dawn" | "day" | "dusk" | "night" {
  const h = date.getHours();
  if (h >= 5 && h < 8) {
    return "dawn";
  }
  if (h >= 8 && h < 17) {
    return "day";
  }
  if (h >= 17 && h < 21) {
    return "dusk";
  }
  return "night";
}

export class WorldStage extends LitElement {
  override createRenderRoot() {
    return this; // light DOM so global world.css applies
  }

  @property({ attribute: false }) agents: GatewayAgentRow[] = [];
  @property() theme = "office";
  @property() basePath = "";
  @property({ attribute: false }) workingAgentIds: string[] = [];
  @property({ attribute: false }) selectedAgentId: string | null = null;
  @property({ attribute: false }) liveSnippet: string | null = null;
  /** Agent whose live output feeds its bubble (the chat-session agent). */
  @property({ attribute: false }) liveSnippetAgentId: string | null = null;
  @property({ attribute: false }) onAgentSelect?: (agentId: string) => void;
  @property({ attribute: false }) onThemeChange?: (theme: string) => void;
  @property({ attribute: false }) onStageClick?: () => void;

  @state() private availW = 0;
  @state() private availH = 0;

  private sim = new Map<string, SimAgent>();
  private tickTimer: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private teleportedAt = 0;
  private model: WorldModel = buildWorld("office", 1);
  private modelKey = "";
  private aspect = 1.6;
  private centeredForKey = "";

  override connectedCallback() {
    super.connectedCallback();
    this.tickTimer = window.setInterval(() => this.tick(), 600);
    this.resizeObserver = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) {
        return;
      }
      this.availW = Math.max(0, Math.floor(rect.width - 4));
      this.availH = Math.max(0, Math.floor(rect.height - 4));
    });
    this.resizeObserver.observe(this);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    if (this.tickTimer !== null) {
      window.clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }

  /** Rebuild the world model if the theme or agent count changed. */
  private syncModel() {
    const key = `${this.theme}:${this.agents.length}`;
    if (key !== this.modelKey) {
      const previous = this.modelKey;
      this.model = buildWorld(this.theme, this.agents.length);
      this.modelKey = key;
      this.aspect = this.model.vw / this.model.vh;
      // On a theme change, reseat everyone instantly (new floor plan).
      const themeChanged = previous.split(":")[0] !== this.theme;
      if (previous && themeChanged) {
        for (const s of this.sim.values()) {
          const p = this.randomWalkPoint();
          s.x = p.x;
          s.y = p.y;
          s.tx = p.x;
          s.ty = p.y;
          s.moveUntil = 0;
          s.pauseUntil = Date.now() + 1000 + Math.random() * 3000;
        }
        this.teleportedAt = Date.now();
      }
    }
  }

  private workingSet(): Set<string> {
    return new Set(this.workingAgentIds);
  }

  private dist(ax: number, ay: number, bx: number, by: number): number {
    const dx = (ax - bx) * this.aspect;
    const dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private randomWalkPoint(): Point {
    const model = this.model;
    for (let attempt = 0; attempt < 24; attempt++) {
      const rect = model.walk[Math.floor(Math.random() * model.walk.length)];
      const x = rect.x + Math.random() * rect.w;
      const y = rect.y + Math.random() * rect.h;
      if (isWalkable(model, x, y)) {
        return { x, y };
      }
    }
    const rect = model.walk[0];
    return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
  }

  private ensureSim(agentId: string): SimAgent {
    let s = this.sim.get(agentId);
    if (!s) {
      const p = this.randomWalkPoint();
      s = {
        x: p.x,
        y: p.y,
        tx: p.x,
        ty: p.y,
        moveUntil: 0,
        moveDur: 0,
        pauseUntil: Date.now() + 500 + Math.random() * 3000,
        facing: FACE_DOWN,
        bubble: null,
        bubbleUntil: 0,
        chatUntil: 0,
        chatCooldownUntil: 0,
        deskIdx: 0,
        targetKind: null,
      };
      this.sim.set(agentId, s);
    }
    return s;
  }

  private startMove(s: SimAgent, x: number, y: number, now: number) {
    const dist = this.dist(s.x, s.y, x, y);
    if (dist < 1) {
      s.pauseUntil = now + 1500;
      return;
    }
    const dur = Math.min(9, Math.max(0.7, dist / WALK_SPEED));
    const dx = (x - s.x) * this.aspect;
    const dy = y - s.y;
    s.facing =
      Math.abs(dx) > Math.abs(dy)
        ? dx > 0
          ? FACE_RIGHT
          : FACE_LEFT
        : dy > 0
          ? FACE_DOWN
          : FACE_UP;
    s.tx = x;
    s.ty = y;
    s.moveDur = dur;
    s.moveUntil = now + dur * 1000;
  }

  private tick() {
    this.syncModel();
    const now = Date.now();
    const model = this.model;
    const liveIds = new Set(this.agents.map((a) => a.id));
    for (const id of [...this.sim.keys()]) {
      if (!liveIds.has(id)) {
        this.sim.delete(id);
      }
    }

    const workingSet = this.workingSet();
    this.agents.forEach((agent, index) => {
      const s = this.ensureSim(agent.id);
      s.deskIdx = Math.min(index, model.desks.length - 1);
      const working = workingSet.has(agent.id);

      // Arrival bookkeeping.
      if (s.moveUntil !== 0 && now >= s.moveUntil) {
        s.x = s.tx;
        s.y = s.ty;
        s.moveUntil = 0;
        s.pauseUntil = now + 2500 + Math.random() * 6000;
        s.facing = working ? FACE_UP : FACE_DOWN;
        if (!working && Math.random() < 0.4) {
          // Say something that matches where the agent just arrived and
          // the time of day — bubbles describe behavior, not random noise.
          const night = dayPhase(new Date(now)) === "night";
          const pool =
            night && Math.random() < 0.4
              ? BUBBLES_NIGHT
              : (BUBBLES_BY_PLACE[s.targetKind ?? "floor"] ?? BUBBLES_BY_PLACE.floor);
          s.bubble = pick(pool);
          s.bubbleUntil = now + 4500;
        }
      }
      if (s.bubbleUntil !== 0 && now >= s.bubbleUntil) {
        s.bubble = null;
        s.bubbleUntil = 0;
      }

      if (working) {
        s.chatUntil = 0;
        const desk = model.desks[s.deskIdx];
        const atDesk = s.moveUntil === 0 && this.dist(s.x, s.y, desk.x, desk.y) < 2;
        if (!atDesk && s.moveUntil === 0) {
          this.startMove(s, desk.x, desk.y, now);
        }
        if (atDesk) {
          s.facing = FACE_UP;
          s.bubble = null;
          s.bubbleUntil = 0;
        }
        return;
      }

      if (now < s.chatUntil) {
        return; // mid-conversation, hold still
      }

      if (s.moveUntil === 0 && now >= s.pauseUntil) {
        if (Math.random() < 0.45 && model.pois.length > 0) {
          const poi = pick(model.pois);
          const jx = poi.x + (Math.random() - 0.5) * 6;
          const jy = poi.y + (Math.random() - 0.5) * 4;
          const target = isWalkable(model, jx, jy) ? { x: jx, y: jy } : poi;
          s.targetKind = poi.kind;
          this.startMove(s, target.x, target.y, now);
        } else {
          const target = this.randomWalkPoint();
          s.targetKind = "floor";
          this.startMove(s, target.x, target.y, now);
        }
      }
    });

    // Chance encounters: two idle agents standing near each other chat.
    const idle = this.agents
      .map((a) => ({ id: a.id, s: this.sim.get(a.id) }))
      .filter(
        (entry): entry is { id: string; s: SimAgent } =>
          Boolean(entry.s) &&
          !workingSet.has(entry.id) &&
          entry.s!.moveUntil === 0 &&
          now >= entry.s!.chatUntil &&
          now >= entry.s!.chatCooldownUntil,
      );
    for (let a = 0; a < idle.length; a++) {
      for (let b = a + 1; b < idle.length; b++) {
        const sa = idle[a].s;
        const sb = idle[b].s;
        if (this.dist(sa.x, sa.y, sb.x, sb.y) < 11 && Math.random() < 0.5) {
          const until = now + 5000;
          sa.chatUntil = until;
          sb.chatUntil = until;
          sa.chatCooldownUntil = now + 70000 + Math.random() * 60000;
          sb.chatCooldownUntil = sa.chatCooldownUntil;
          sa.facing = sb.x >= sa.x ? FACE_RIGHT : FACE_LEFT;
          sb.facing = sa.x >= sb.x ? FACE_RIGHT : FACE_LEFT;
          sa.bubble = pick(CHAT_OPENERS);
          sb.bubble = pick(CHAT_REPLIES);
          sa.bubbleUntil = until;
          sb.bubbleUntil = until + 400;
        }
      }
    }

    this.requestUpdate();
  }

  // ── Rendering ────────────────────────────────────────────────────────

  private renderProp(prop: Prop, workingDeskIdxs: ReadonlySet<number>) {
    const isWorkstation = prop.kind === "desk" || prop.kind === "stump";
    const active =
      isWorkstation && prop.deskIdx !== undefined && workingDeskIdxs.has(prop.deskIdx);
    // Each workstation belongs to one agent: its monitor carries the owner's
    // sprite hue, so "whose desk is this" is visible at a glance.
    let hue = 0;
    if (isWorkstation && prop.deskIdx !== undefined) {
      const owner = this.agents[prop.deskIdx];
      if (owner) {
        hue = spriteArtFor(owner.id || agentDisplayName(owner), this.basePath).hue;
      }
    }
    return html`
      <div
        class="ws-prop ws-prop--${prop.kind} ${active ? "is-active" : ""}"
        style="left:${prop.x}%;top:${prop.y}%;width:calc(var(--u) * ${prop.w});z-index:${Math.round(
          prop.y * 10,
        )};--hue:${hue}deg"
      >
        ${PROP_ART[prop.kind] ?? nothing}
      </div>
    `;
  }

  private renderAgent(agent: GatewayAgentRow, now: number) {
    const s = this.ensureSim(agent.id);
    const working = this.workingSet().has(agent.id);
    const selected = agent.id === this.selectedAgentId;
    const moving = s.moveUntil > now;
    const chatting = now < s.chatUntil;
    const noAnim = now - this.teleportedAt < 500;
    const left = moving ? s.tx : s.x;
    const top = moving ? s.ty : s.y;
    const art = spriteArtFor(agent.id || agentDisplayName(agent), this.basePath);
    const name = agentDisplayName(agent);
    let bubble: string | null = s.bubble;
    if (working) {
      const snippet =
        agent.id === this.liveSnippetAgentId ? (this.liveSnippet ?? "").trim() : "";
      bubble = snippet ? snippet.slice(-64) : "working…";
    }
    const classes = [
      "ws-agent",
      moving ? "is-walking" : "",
      working ? "is-working" : "",
      selected ? "is-selected" : "",
      chatting ? "is-chatting" : "",
      noAnim ? "no-anim" : "",
    ]
      .filter(Boolean)
      .join(" ");
    return html`
      <button
        class=${classes}
        style="left:${left}%;top:${top}%;--movedur:${s.moveDur}s;z-index:${Math.round(top * 10) +
        5}"
        title="${name} · ${agentModelLabel(agent)} · ${working
          ? "working"
          : "idle"} — click to give it a task"
        @click=${(e: Event) => {
          e.stopPropagation();
          this.onAgentSelect?.(agent.id);
        }}
      >
        ${bubble
          ? html`<span class="ws-bubble ${working ? "ws-bubble--working" : ""}">
              ${working ? html`<span class="ws-bubble-dots"><i></i><i></i><i></i></span>` : nothing}
              <span class="ws-bubble-text">${bubble}</span>
            </span>`
          : nothing}
        <span class="ws-ring"></span>
        <span class="ws-shadow"></span>
        <span
          class="ws-sprite"
          style="background-image:url('${art.url}');--dirx:${s.facing};--hue:${art.hue}deg"
        ></span>
        <span class="ws-nametag">
          <span class="ws-nametag-name">${name}</span>
          ${working ? html`<span class="ws-nametag-dot"></span>` : nothing}
        </span>
      </button>
    `;
  }

  private renderParticles(phase: string) {
    const parts: unknown[] = [];
    const mk = (cls: string, count: number, seedBase: number) => {
      for (let i = 0; i < count; i++) {
        const left = 6 + fract(seedBase + i) * 88;
        const top = 10 + fract(seedBase + i + 50) * 75;
        const dur = 6 + fract(seedBase + i + 100) * 9;
        const delay = fract(seedBase + i + 150) * 8;
        parts.push(
          html`<span
            class="ws-particle ${cls}"
            style="left:${left}%;top:${top}%;animation-duration:${dur}s;animation-delay:-${delay}s"
          ></span>`,
        );
      }
    };
    if (this.theme === "forest") {
      if (phase === "night" || phase === "dusk") {
        mk("ws-particle--firefly", 10, 7);
      } else {
        mk("ws-particle--leaf", 6, 13);
      }
      // Embers rise from the campfire.
      const fire = this.model.props.find((p) => p.kind === "campfire");
      if (fire) {
        for (let i = 0; i < 3; i++) {
          const left = fire.x - 1 + fract(29 + i) * 2;
          const top = fire.y - 1 + fract(79 + i) * 2;
          const dur = 1.6 + fract(129 + i) * 1.4;
          const delay = fract(179 + i) * 2;
          parts.push(
            html`<span
              class="ws-particle ws-particle--ember"
              style="left:${left}%;top:${top}%;animation-duration:${dur}s;animation-delay:-${delay}s"
            ></span>`,
          );
        }
      }
    } else if (this.theme === "office") {
      mk("ws-particle--dust", 7, 17);
    } else {
      mk("ws-particle--spark", 8, 23);
    }
    return parts;
  }

  override updated() {
    // Center the scroll once per new map size when it overflows the viewport.
    const zoom = this.zoom();
    const mapW = this.model.vw * zoom;
    const mapH = this.model.vh * zoom;
    const key = `${this.modelKey}:${Math.round(mapW)}x${Math.round(mapH)}`;
    if (key === this.centeredForKey) {
      return;
    }
    const vp = this.querySelector<HTMLElement>(".ws-scroll");
    if (!vp) {
      return;
    }
    if (mapW > vp.clientWidth || mapH > vp.clientHeight) {
      vp.scrollLeft = (mapW - vp.clientWidth) / 2;
      vp.scrollTop = (mapH - vp.clientHeight) / 2;
    }
    this.centeredForKey = key;
  }

  /** Fit-to-viewport zoom, clamped so the world stays readable but can grow. */
  private zoom(): number {
    if (this.availW < 40 || this.availH < 40) {
      return 1;
    }
    const fit = Math.min(this.availW / this.model.vw, this.availH / this.model.vh);
    return Math.min(1.35, Math.max(0.5, fit));
  }

  override render() {
    this.syncModel();
    const model = this.model;
    const now = Date.now();
    const date = new Date(now);
    const phase = dayPhase(date);
    const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const workingSet = this.workingSet();
    const workingAgents = this.agents.filter((a) => workingSet.has(a.id));
    const workingCount = workingAgents.length;
    const workingDeskIdxs = new Set<number>();
    for (const agent of workingAgents) {
      const sim = this.sim.get(agent.id);
      if (sim) {
        workingDeskIdxs.add(sim.deskIdx);
      }
    }
    if (this.availW < 40) {
      return html`<div class="ws-viewport"></div>`;
    }
    const zoom = this.zoom();
    const mapW = Math.round(model.vw * zoom);
    const mapH = Math.round(model.vh * zoom);
    const phaseIcon = phase === "night" ? "🌙" : phase === "day" ? "☀️" : "🌤";
    return html`
      <div
        class="ws-viewport"
        @click=${(e: Event) => {
          const el = e.target as HTMLElement;
          if (!el.closest(".ws-agent") && !el.closest(".ws-themes") && !el.closest(".ws-hud")) {
            this.onStageClick?.();
          }
        }}
      >
        <div class="ws-scroll">
          <div
            class="ws-map ws-map--${this.theme} ws-phase--${phase}"
            style="width:${mapW}px;height:${mapH}px;--u:${mapW / 100}px"
          >
            <div class="ws-floor"></div>
            ${model.zones.map(
              (zone) => html`
                <span class="ws-zone" style="left:${zone.x}%;top:${zone.y}%">${zone.label}</span>
              `,
            )}
            ${model.props.map((prop) => this.renderProp(prop, workingDeskIdxs))}
            ${this.agents.map((agent) => this.renderAgent(agent, now))}
            <div class="ws-tint"></div>
            ${this.renderParticles(phase)}
          </div>
        </div>
        <div class="ws-hud">
          <span class="ws-hud-time">${phaseIcon} ${time}</span>
          <span class="ws-hud-sep">·</span>
          <span>${this.agents.length} agent${this.agents.length === 1 ? "" : "s"}</span>
          <span class="ws-hud-sep">·</span>
          <span class="${workingCount > 0 ? "ws-hud-working" : ""}"
            >${workingCount > 0 ? `${workingCount} working` : "all idle"}</span
          >
        </div>
        <div class="ws-themes">
          ${WORLD_THEMES.map(
            (entry) => html`
              <button
                class="ws-theme-btn ${this.theme === entry.id ? "is-active" : ""}"
                @click=${() => this.onThemeChange?.(entry.id)}
              >
                ${entry.label}
              </button>
            `,
          )}
        </div>
      </div>
    `;
  }
}

// ── Pixel props (hand-drawn SVG rect art, crisp-scaled) ────────────────

const PROP_ART: Record<string, unknown> = {
  desk: html`
    <svg viewBox="0 0 24 18" shape-rendering="crispEdges" aria-hidden="true">
      <rect x="8" y="1" width="8" height="6" fill="#20232b" />
      <rect x="9" y="2" width="6" height="4" class="ws-screen" fill="#3a4354" />
      <rect x="11" y="7" width="2" height="1" fill="#20232b" />
      <rect x="2" y="8" width="20" height="4" fill="#a97142" />
      <rect x="2" y="8" width="20" height="1" fill="#c98d59" />
      <rect x="8" y="9" width="8" height="2" fill="#8b5a2b" />
      <rect x="3" y="12" width="2" height="4" fill="#6f4620" />
      <rect x="19" y="12" width="2" height="4" fill="#6f4620" />
    </svg>
  `,
  stump: html`
    <svg viewBox="0 0 16 14" shape-rendering="crispEdges" aria-hidden="true">
      <rect x="5" y="0" width="6" height="4" fill="#2b2f38" />
      <rect x="6" y="1" width="4" height="2" class="ws-screen" fill="#3a4354" />
      <rect x="2" y="4" width="12" height="5" fill="#c9a06c" />
      <rect x="4" y="5" width="8" height="3" fill="#a97e4b" />
      <rect x="6" y="6" width="4" height="1" fill="#8a6236" />
      <rect x="2" y="9" width="12" height="4" fill="#8a6236" />
      <rect x="3" y="9" width="2" height="4" fill="#6f4a24" />
      <rect x="11" y="9" width="2" height="4" fill="#6f4a24" />
    </svg>
  `,
  coffee: html`
    <svg viewBox="0 0 14 18" shape-rendering="crispEdges" aria-hidden="true">
      <rect x="2" y="1" width="10" height="15" fill="#3b3f4a" />
      <rect x="3" y="2" width="8" height="3" fill="#262a33" />
      <rect x="9" y="3" width="1" height="1" fill="#ff5f5f" />
      <rect x="4" y="6" width="6" height="4" fill="#14161c" />
      <rect x="6" y="8" width="2" height="2" fill="#f2ede4" />
      <rect x="5" y="10" width="4" height="1" fill="#c9a06c" />
      <rect x="2" y="13" width="10" height="3" fill="#2c303a" />
      <rect x="5" y="4" width="1" height="1" class="ws-steam ws-steam--a" fill="#dfe6ee" />
      <rect x="8" y="3" width="1" height="1" class="ws-steam ws-steam--b" fill="#dfe6ee" />
    </svg>
  `,
  watercooler: html`
    <svg viewBox="0 0 10 16" shape-rendering="crispEdges" aria-hidden="true">
      <rect x="2" y="1" width="6" height="4" fill="#9fd0ea" />
      <rect x="3" y="2" width="2" height="2" fill="#cdeaf7" />
      <rect x="1" y="5" width="8" height="8" fill="#dfe6ee" />
      <rect x="2" y="6" width="6" height="2" fill="#b9c4cf" />
      <rect x="2" y="13" width="6" height="2" fill="#8f99a3" />
    </svg>
  `,
  server: html`
    <svg viewBox="0 0 14 20" shape-rendering="crispEdges" aria-hidden="true">
      <rect x="1" y="1" width="12" height="18" fill="#232733" />
      <rect x="2" y="2" width="10" height="3" fill="#2e3442" />
      <rect x="2" y="6" width="10" height="3" fill="#2e3442" />
      <rect x="2" y="10" width="10" height="3" fill="#2e3442" />
      <rect x="2" y="14" width="10" height="4" fill="#2e3442" />
      <rect x="10" y="3" width="1" height="1" class="ws-led ws-led--1" fill="#54e08a" />
      <rect x="10" y="7" width="1" height="1" class="ws-led ws-led--2" fill="#54e08a" />
      <rect x="10" y="11" width="1" height="1" class="ws-led ws-led--3" fill="#ffbf47" />
      <rect x="10" y="15" width="1" height="1" class="ws-led ws-led--4" fill="#54e08a" />
      <rect x="3" y="3" width="4" height="1" fill="#1a1e28" />
      <rect x="3" y="7" width="4" height="1" fill="#1a1e28" />
      <rect x="3" y="11" width="4" height="1" fill="#1a1e28" />
    </svg>
  `,
  whiteboard: html`
    <svg viewBox="0 0 26 14" shape-rendering="crispEdges" aria-hidden="true">
      <rect x="1" y="1" width="24" height="12" fill="#b9c4cf" />
      <rect x="2" y="2" width="22" height="10" fill="#f2f5f8" />
      <rect x="4" y="4" width="8" height="1" fill="#5b79d6" />
      <rect x="4" y="6" width="12" height="1" fill="#5b79d6" />
      <rect x="4" y="8" width="6" height="1" fill="#d66b6b" />
      <rect x="17" y="4" width="5" height="4" fill="#7fc98d" />
      <rect x="13" y="9" width="9" height="1" fill="#9aa7b4" />
    </svg>
  `,
  bookshelf: html`
    <svg viewBox="0 0 20 16" shape-rendering="crispEdges" aria-hidden="true">
      <rect x="1" y="0" width="18" height="15" fill="#6f4a24" />
      <rect x="2" y="1" width="16" height="5" fill="#4a3118" />
      <rect x="2" y="8" width="16" height="5" fill="#4a3118" />
      <rect x="3" y="2" width="2" height="4" fill="#d66b6b" />
      <rect x="5" y="2" width="2" height="4" fill="#5b79d6" />
      <rect x="7" y="3" width="2" height="3" fill="#7fc98d" />
      <rect x="10" y="2" width="2" height="4" fill="#ffbf47" />
      <rect x="13" y="3" width="2" height="3" fill="#b57edc" />
      <rect x="4" y="9" width="2" height="4" fill="#5b79d6" />
      <rect x="7" y="10" width="2" height="3" fill="#d66b6b" />
      <rect x="10" y="9" width="2" height="4" fill="#7fc98d" />
      <rect x="14" y="10" width="2" height="3" fill="#ffbf47" />
    </svg>
  `,
  clock: html`
    <svg viewBox="0 0 8 8" shape-rendering="crispEdges" aria-hidden="true">
      <rect x="1" y="0" width="6" height="8" fill="#2c303a" />
      <rect x="2" y="1" width="4" height="6" fill="#f2f5f8" />
      <rect x="3" y="3" width="2" height="1" fill="#2c303a" />
      <rect x="4" y="4" width="1" height="2" fill="#d66b6b" />
    </svg>
  `,
  plant: html`
    <svg viewBox="0 0 12 16" shape-rendering="crispEdges" aria-hidden="true">
      <rect x="5" y="4" width="2" height="4" fill="#3f7d46" />
      <rect x="2" y="2" width="3" height="3" fill="#54a05c" />
      <rect x="7" y="1" width="3" height="3" fill="#54a05c" />
      <rect x="4" y="0" width="3" height="3" fill="#6cbb74" />
      <rect x="3" y="5" width="2" height="2" fill="#3f7d46" />
      <rect x="8" y="4" width="2" height="2" fill="#3f7d46" />
      <rect x="3" y="8" width="6" height="2" fill="#c96f3a" />
      <rect x="4" y="10" width="4" height="5" fill="#a34f27" />
    </svg>
  `,
  tree: html`
    <svg viewBox="0 0 20 24" shape-rendering="crispEdges" aria-hidden="true">
      <rect x="8" y="16" width="4" height="7" fill="#6f4a24" />
      <rect x="8" y="16" width="2" height="7" fill="#7d5628" />
      <rect x="4" y="4" width="12" height="4" fill="#3f7d46" />
      <rect x="2" y="7" width="16" height="6" fill="#4c9152" />
      <rect x="4" y="12" width="12" height="4" fill="#3f7d46" />
      <rect x="6" y="2" width="8" height="3" fill="#59a860" />
      <rect x="5" y="8" width="4" height="2" fill="#65b86d" />
      <rect x="11" y="6" width="3" height="2" fill="#65b86d" />
    </svg>
  `,
  rug: html`
    <svg viewBox="0 0 26 14" shape-rendering="crispEdges" aria-hidden="true" opacity="0.85">
      <rect x="0" y="0" width="26" height="14" fill="#8d4f57" />
      <rect x="1" y="1" width="24" height="12" fill="#a35f68" />
      <rect x="3" y="3" width="20" height="8" fill="#8d4f57" />
      <rect x="5" y="5" width="16" height="4" fill="#b8737c" />
    </svg>
  `,
  campfire: html`
    <svg viewBox="0 0 16 14" shape-rendering="crispEdges" aria-hidden="true">
      <rect x="2" y="11" width="12" height="2" fill="#6f4a24" />
      <rect x="4" y="10" width="8" height="1" fill="#8a6236" />
      <rect x="6" y="4" width="4" height="6" class="ws-flame-outer" fill="#ff8c1a" />
      <rect x="7" y="2" width="2" height="3" class="ws-flame-tip" fill="#ff8c1a" />
      <rect x="7" y="6" width="2" height="4" class="ws-flame-inner" fill="#ffd23e" />
    </svg>
  `,
  tent: html`
    <svg viewBox="0 0 20 14" shape-rendering="crispEdges" aria-hidden="true">
      <rect x="8" y="0" width="4" height="2" fill="#8d4f2e" />
      <rect x="6" y="2" width="8" height="3" fill="#c96f3a" />
      <rect x="4" y="5" width="12" height="3" fill="#d97f47" />
      <rect x="2" y="8" width="16" height="5" fill="#c96f3a" />
      <rect x="8" y="8" width="4" height="5" fill="#5a3419" />
      <rect x="9" y="9" width="2" height="4" fill="#2f1a0b" />
    </svg>
  `,
  sign: html`
    <svg viewBox="0 0 14 16" shape-rendering="crispEdges" aria-hidden="true">
      <rect x="6" y="7" width="2" height="8" fill="#6f4a24" />
      <rect x="1" y="1" width="12" height="6" fill="#c9a06c" />
      <rect x="2" y="2" width="10" height="4" fill="#a97e4b" />
      <rect x="3" y="3" width="4" height="1" fill="#5a3c1c" />
      <rect x="3" y="5" width="6" height="1" fill="#5a3c1c" />
    </svg>
  `,
  pond: html`
    <svg viewBox="0 0 40 24" shape-rendering="crispEdges" aria-hidden="true">
      <rect x="4" y="4" width="32" height="16" fill="#3f6f8a" />
      <rect x="6" y="6" width="28" height="12" fill="#5a97b8" />
      <rect x="9" y="8" width="10" height="2" fill="#7fb8d4" />
      <rect x="22" y="12" width="8" height="2" fill="#7fb8d4" />
      <rect x="4" y="4" width="32" height="2" fill="#345d73" />
    </svg>
  `,
};

if (!customElements.get("world-stage")) {
  customElements.define("world-stage", WorldStage);
}

declare global {
  interface HTMLElementTagNameMap {
    "world-stage": WorldStage;
  }
}
