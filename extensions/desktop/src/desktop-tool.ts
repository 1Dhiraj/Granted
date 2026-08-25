import os from "node:os";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import {
  type AnyAgentTool,
  imageResultFromFile,
  jsonResult,
  readStringParam,
} from "openclaw/plugin-sdk/browser-setup-tools";
import { optionalStringEnum, stringEnum } from "openclaw/plugin-sdk/channel-actions";
import { runPowerShellJson } from "./powershell.js";
import {
  APPS_SCRIPT,
  CLICK_SCRIPT,
  CLIPBOARD_SCRIPT,
  DRAG_SCRIPT,
  FIND_SCRIPT,
  FOCUS_SCRIPT,
  KEY_SCRIPT,
  LAUNCH_SCRIPT,
  MOVE_SCRIPT,
  PASTE_SCRIPT,
  PATTERN_SCRIPT,
  READ_SCRIPT,
  SCREENSHOT_SCRIPT,
  SCROLL_SCRIPT,
  SNAPSHOT_SCRIPT,
  STATUS_SCRIPT,
  TYPE_SCRIPT,
  WAIT_SCRIPT,
  WINDOW_SCRIPT,
} from "./scripts.js";

const DESKTOP_ACTIONS = [
  "status",
  "apps",
  "focus",
  "launch",
  "snapshot",
  "find",
  "act",
  "read",
  "window",
  "wait",
  "clipboard",
  "screenshot",
] as const;

const DESKTOP_ACT_KINDS = [
  "click",
  "type",
  "paste",
  "key",
  "scroll",
  "move",
  "drag",
  "invoke",
  "toggle",
  "expand",
  "collapse",
  "select",
] as const;

const WINDOW_OPS = ["maximize", "minimize", "restore", "close", "move", "resize"] as const;

const UIA_PATTERN_KINDS = new Set(["invoke", "toggle", "expand", "collapse", "select"]);

const DesktopToolSchema = Type.Object(
  {
    action: stringEnum(DESKTOP_ACTIONS),
    title: Type.Optional(
      Type.String({
        description:
          "Window title substring (optional everywhere). Omit it to target the FOREGROUND window — which is what you want right after launching or focusing an app. Note: a window's title is often the document/workspace name, not the app name (e.g. Notion shows your workspace name, not \"Notion\"), so prefer omitting title over guessing it. Use action=apps to read real titles.",
      }),
    ),
    app: Type.Optional(
      Type.String({
        description: 'Executable name or path for launch (e.g. "notepad", "calc", "chrome").',
      }),
    ),
    appArgs: Type.Optional(Type.String({ description: "Arguments passed to the launched app." })),
    kind: optionalStringEnum(DESKTOP_ACT_KINDS, {
      description: "Interaction kind for act.",
    }),
    ref: Type.Optional(
      Type.String({ description: "Element ref from the LATEST snapshot (e.g. e12)." }),
    ),
    x: Type.Optional(Type.Number({ description: "Screen X coordinate (click/scroll/move)." })),
    y: Type.Optional(Type.Number({ description: "Screen Y coordinate (click/scroll/move)." })),
    text: Type.Optional(Type.String({ description: "Text to type into the focused control." })),
    keys: Type.Optional(
      Type.String({ description: 'Key or combo, e.g. "enter", "ctrl+s", "alt+f4", "win".' }),
    ),
    button: optionalStringEnum(["left", "right", "middle"] as const, {
      description: "Mouse button for click (default left).",
    }),
    doubleClick: Type.Optional(Type.Boolean({ description: "Double-click instead of single." })),
    scrollDelta: Type.Optional(
      Type.Number({ description: "Wheel notches: positive scrolls up, negative scrolls down." }),
    ),
    toRef: Type.Optional(
      Type.String({ description: "Drag destination element ref from the latest snapshot." }),
    ),
    toX: Type.Optional(Type.Number({ description: "Drag destination X (when no toRef)." })),
    toY: Type.Optional(Type.Number({ description: "Drag destination Y (when no toRef)." })),
    windowOp: optionalStringEnum(WINDOW_OPS, {
      description: "Window operation for action=window.",
    }),
    width: Type.Optional(Type.Number({ description: "Window width for windowOp=resize." })),
    height: Type.Optional(Type.Number({ description: "Window height for windowOp=resize." })),
    clipboardOp: optionalStringEnum(["get", "set"] as const, {
      description: "Clipboard operation for action=clipboard (default get).",
    }),
    name: Type.Optional(
      Type.String({
        description: "Element name/value substring for find and wait (case-insensitive).",
      }),
    ),
    role: Type.Optional(
      Type.String({ description: 'Optional role filter for find/wait (e.g. "Button", "Edit").' }),
    ),
    timeoutMs: Type.Optional(
      Type.Number({ description: "Wait timeout in ms (default 10000, max 30000)." }),
    ),
    maxChars: Type.Optional(
      Type.Number({ description: "Max characters returned by action=read (default 2000)." }),
    ),
    annotate: Type.Optional(
      Type.Boolean({
        description:
          "For screenshot: draw labeled red boxes for every ref from the latest snapshot/find, so the image and refs line up.",
      }),
    ),
    grid: Type.Optional(
      Type.Boolean({
        description:
          "For screenshot: overlay a labeled 100px coordinate grid. Use when the snapshot has no elements (canvas/GPU apps) — read the target's x,y off the grid, then act kind=click x=.. y=..",
      }),
    ),
    window: Type.Optional(
      Type.Boolean({
        description:
          "For screenshot: capture only the TARGET window's own pixels (set title to pick it, else the foreground window). Works even when that window is BEHIND others / not in the foreground — use this to see a background app. Coordinates in the image are relative to the window (its screen position is returned in rect).",
      }),
    ),
  },
  { additionalProperties: false },
);

const VK_CODES: Record<string, number> = {
  enter: 0x0d,
  return: 0x0d,
  tab: 0x09,
  escape: 0x1b,
  esc: 0x1b,
  backspace: 0x08,
  delete: 0x2e,
  del: 0x2e,
  insert: 0x2d,
  space: 0x20,
  up: 0x26,
  down: 0x28,
  left: 0x25,
  right: 0x27,
  home: 0x24,
  end: 0x23,
  pageup: 0x21,
  pagedown: 0x22,
  ctrl: 0x11,
  control: 0x11,
  alt: 0x12,
  shift: 0x10,
  win: 0x5b,
  meta: 0x5b,
  capslock: 0x14,
  printscreen: 0x2c,
};
for (let i = 1; i <= 24; i++) {
  VK_CODES[`f${i}`] = 0x70 + (i - 1);
}
for (let c = 0; c < 26; c++) {
  VK_CODES[String.fromCharCode(97 + c)] = 0x41 + c;
}
for (let d = 0; d <= 9; d++) {
  VK_CODES[String(d)] = 0x30 + d;
}

const MODIFIER_KEYS = new Set(["ctrl", "control", "alt", "shift", "win", "meta"]);

function parseKeyCombo(combo: string): { modifiers: number[]; key: number; label: string } {
  const parts = combo
    .toLowerCase()
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    throw new Error(`desktop: empty key combo`);
  }
  const keyName = parts[parts.length - 1];
  const modifierNames = parts.slice(0, -1);
  const key = VK_CODES[keyName];
  if (key === undefined) {
    throw new Error(
      `desktop: unknown key "${keyName}". Use names like enter, tab, esc, ctrl+s, alt+f4, win.`,
    );
  }
  const modifiers: number[] = [];
  for (const mod of modifierNames) {
    if (!MODIFIER_KEYS.has(mod)) {
      throw new Error(`desktop: unknown modifier "${mod}" (use ctrl, alt, shift, win).`);
    }
    const vk = VK_CODES[mod];
    if (vk !== undefined) {
      modifiers.push(vk);
    }
  }
  return { modifiers, key, label: combo };
}

type SnapshotElement = {
  role: string;
  name: string;
  value: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  enabled: boolean;
};

type SnapshotPayload = {
  ok: boolean;
  error?: string;
  window?: { title: string; processId: number };
  elements?: SnapshotElement[];
  truncated?: boolean;
  hint?: string;
};

type RefEntry = { x: number; y: number; w: number; h: number; role: string; name: string };

// Refs from the most recent snapshot. The gateway process is long-lived, so a
// module-level cache survives across tool calls within a run. Refs go stale on
// every new snapshot, mirroring the browser tool's behavior.
let lastRefs = new Map<string, RefEntry>();
let lastRefsWindowTitle = "";

function formatSnapshot(payload: SnapshotPayload): string {
  const lines: string[] = [];
  const win = payload.window;
  lines.push(`window "${win?.title ?? "?"}" (pid ${win?.processId ?? "?"})`);
  const elements = payload.elements ?? [];
  const refs = new Map<string, RefEntry>();
  let n = 0;
  for (const el of elements) {
    n += 1;
    const ref = `e${n}`;
    refs.set(ref, { x: el.x, y: el.y, w: el.w, h: el.h, role: el.role, name: el.name });
    const valuePart = el.value ? ` value=${JSON.stringify(el.value)}` : "";
    const disabledPart = el.enabled === false ? " [disabled]" : "";
    const namePart = el.name ? ` ${JSON.stringify(el.name)}` : "";
    lines.push(`- ${ref} ${el.role}${namePart}${valuePart} (${el.x},${el.y})${disabledPart}`);
  }
  lastRefs = refs;
  lastRefsWindowTitle = win?.title ?? "";
  if (payload.truncated) {
    lines.push(`(truncated — element budget reached; focus a narrower window or use title)`);
  }
  if (n === 0) {
    lines.push(
      payload.hint
        ? `(no readable elements — ${payload.hint})`
        : "(no readable elements — the app renders via canvas/GPU; VISION FALLBACK: action=screenshot grid=true, read the target's x,y from the grid labels, then act kind=click x=.. y=..)",
    );
  } else {
    lines.push(`Interact with: act kind=click ref=eN, then re-snapshot after UI changes.`);
  }
  return lines.join("\n");
}

function requireNumber(params: Record<string, unknown>, key: string): number {
  const value = params[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`desktop: "${key}" (number) is required for this act kind.`);
  }
  return value;
}

/** Resolve a screen point from a snapshot ref, or fall back to explicit coordinates. */
function resolvePoint(
  params: Record<string, unknown>,
  refKey: string,
  xKey: string,
  yKey: string,
): { x: number; y: number } {
  const ref = readStringParam(params, refKey) || undefined;
  if (ref) {
    const entry = lastRefs.get(ref);
    if (!entry) {
      throw new Error(
        `desktop: unknown ref "${ref}" — take a new snapshot first (refs are valid only for the latest snapshot${lastRefsWindowTitle ? ` of "${lastRefsWindowTitle}"` : ""}).`,
      );
    }
    return { x: entry.x, y: entry.y };
  }
  return { x: requireNumber(params, xKey), y: requireNumber(params, yKey) };
}

export function createDesktopTool(opts?: {
  maxSnapshotElements?: number;
  maxSnapshotDepth?: number;
}): AnyAgentTool {
  const maxElements = opts?.maxSnapshotElements ?? 300;
  const maxDepth = opts?.maxSnapshotDepth ?? 15;
  return {
    label: "Desktop",
    name: "desktop",
    description: [
      "Control the local Windows desktop (any app) via UI Automation + synthesized input. Windows only; shares the real mouse/keyboard; cannot reach UAC/elevated prompts.",
      "Flow: launch or focus the app, then snapshot (NO title = foreground window; pass title only for a background window — never guess a title), then act on refs (e12) from the LATEST snapshot, then verify with read. Prefer keyboard shortcuts (Ctrl+N/S/T/F, Enter) over hunting menus. Use find (name, optional role) instead of a full snapshot in dense apps. Refs go stale after any layout change — re-snapshot.",
      "ACTIONS: apps (list windows) · launch (app) · focus (title) · snapshot (title optional) · find (name, role) · act · read (ref, maxChars) · window (windowOp=maximize|minimize|restore|close|move|resize) · wait (name/role, timeoutMs) · clipboard (clipboardOp=get|set) · screenshot.",
      "SAFETY: launch returns ok:false with reusedExistingWindow=true when the app was ALREADY running — you are looking at the user's own open document, not a blank one. Never type or send keys then: open a fresh document first (act kind=key keys=ctrl+n) and snapshot to confirm it is empty. You share the real keyboard, so a wrong keystroke edits the user's work.",
      'ACT KINDS: click (ref or x/y) · type (SHORT text into focused field) · paste (prefer for long/multiline text) · key (e.g. "ctrl+s") · scroll (scrollDelta) · move · drag (ref→toRef) · invoke/toggle/expand/collapse/select (UIA patterns on a ref — more reliable than click for checkboxes/combos/tree nodes).',
      "SCREENSHOT (only when the tree is empty/insufficient, e.g. canvas/GPU apps): grid=true overlays a coordinate grid → read x,y and act kind=click x/y. window=true title=<app> captures a background window's own pixels. annotate=true labels the latest refs.",
    ].join(" "),
    parameters: DesktopToolSchema,
    execute: async (_toolCallId, args) => {
      if (process.platform !== "win32") {
        throw new Error("desktop: this tool only runs on Windows hosts.");
      }
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      switch (action) {
        case "status": {
          return jsonResult(await runPowerShellJson(STATUS_SCRIPT, {}, 20_000));
        }
        case "apps": {
          return jsonResult(await runPowerShellJson(APPS_SCRIPT, {}, 20_000));
        }
        case "focus": {
          const title = readStringParam(params, "title") || "";
          return jsonResult(await runPowerShellJson(FOCUS_SCRIPT, { title }, 20_000));
        }
        case "launch": {
          const app = readStringParam(params, "app", { required: true });
          const appArgs = readStringParam(params, "appArgs") || undefined;
          return jsonResult(await runPowerShellJson(LAUNCH_SCRIPT, { app, appArgs }, 30_000));
        }
        case "snapshot": {
          const title = readStringParam(params, "title") || undefined;
          const payload = await runPowerShellJson<SnapshotPayload>(
            SNAPSHOT_SCRIPT,
            { title, maxElements, maxDepth },
            60_000,
          );
          if (!payload.ok) {
            throw new Error(`desktop: ${payload.error ?? "snapshot failed"}`);
          }
          return {
            content: [{ type: "text" as const, text: formatSnapshot(payload) }],
            details: { window: payload.window, count: payload.elements?.length ?? 0 },
          };
        }
        case "act": {
          const kind = readStringParam(params, "kind", { required: true });
          if (UIA_PATTERN_KINDS.has(kind)) {
            const point = resolvePoint(params, "ref", "x", "y");
            return jsonResult(
              await runPowerShellJson(PATTERN_SCRIPT, { ...point, op: kind }, 30_000),
            );
          }
          switch (kind) {
            case "click": {
              const point = resolvePoint(params, "ref", "x", "y");
              const button = readStringParam(params, "button") || "left";
              const double = params.doubleClick === true;
              return jsonResult(
                await runPowerShellJson(CLICK_SCRIPT, { ...point, button, double }, 20_000),
              );
            }
            case "type": {
              const text = readStringParam(params, "text", { required: true });
              const timeout = Math.max(20_000, text.length * 30 + 10_000);
              return jsonResult(await runPowerShellJson(TYPE_SCRIPT, { text }, timeout));
            }
            case "paste": {
              const text = readStringParam(params, "text", { required: true });
              return jsonResult(await runPowerShellJson(PASTE_SCRIPT, { text }, 30_000));
            }
            case "key": {
              const keys = readStringParam(params, "keys", { required: true });
              const combo = parseKeyCombo(keys);
              return jsonResult(
                await runPowerShellJson(
                  KEY_SCRIPT,
                  { modifiers: combo.modifiers, key: combo.key, label: combo.label },
                  20_000,
                ),
              );
            }
            case "scroll": {
              const delta = requireNumber(params, "scrollDelta");
              const x = typeof params.x === "number" ? params.x : undefined;
              const y = typeof params.y === "number" ? params.y : undefined;
              return jsonResult(await runPowerShellJson(SCROLL_SCRIPT, { delta, x, y }, 20_000));
            }
            case "move": {
              const x = requireNumber(params, "x");
              const y = requireNumber(params, "y");
              return jsonResult(await runPowerShellJson(MOVE_SCRIPT, { x, y }, 20_000));
            }
            case "drag": {
              const from = resolvePoint(params, "ref", "x", "y");
              const to = resolvePoint(params, "toRef", "toX", "toY");
              return jsonResult(
                await runPowerShellJson(
                  DRAG_SCRIPT,
                  { x: from.x, y: from.y, toX: to.x, toY: to.y },
                  30_000,
                ),
              );
            }
            default:
              throw new Error(`desktop: unknown act kind "${kind}".`);
          }
        }
        case "read": {
          const point = resolvePoint(params, "ref", "x", "y");
          const maxChars = typeof params.maxChars === "number" ? params.maxChars : undefined;
          return jsonResult(await runPowerShellJson(READ_SCRIPT, { ...point, maxChars }, 30_000));
        }
        case "window": {
          const op = readStringParam(params, "windowOp", { required: true });
          const title = readStringParam(params, "title") || "";
          const args: Record<string, unknown> = { title, op };
          if (op === "move") {
            args.x = requireNumber(params, "x");
            args.y = requireNumber(params, "y");
          }
          if (op === "resize") {
            args.width = requireNumber(params, "width");
            args.height = requireNumber(params, "height");
          }
          return jsonResult(await runPowerShellJson(WINDOW_SCRIPT, args, 20_000));
        }
        case "wait": {
          const title = readStringParam(params, "title") || "";
          const name = readStringParam(params, "name") || undefined;
          const role = readStringParam(params, "role") || undefined;
          const timeoutMs = typeof params.timeoutMs === "number" ? params.timeoutMs : undefined;
          const budget = Math.min(typeof timeoutMs === "number" ? timeoutMs : 10_000, 30_000);
          return jsonResult(
            await runPowerShellJson(WAIT_SCRIPT, { title, name, role, timeoutMs }, budget + 15_000),
          );
        }
        case "clipboard": {
          const op = readStringParam(params, "clipboardOp") || "get";
          const text = readStringParam(params, "text") || "";
          if (op === "set" && !text) {
            throw new Error('desktop: clipboard set requires "text".');
          }
          return jsonResult(await runPowerShellJson(CLIPBOARD_SCRIPT, { op, text }, 20_000));
        }
        case "find": {
          const title = readStringParam(params, "title") || "";
          const name = readStringParam(params, "name", { required: true });
          const role = readStringParam(params, "role") || undefined;
          const payload = await runPowerShellJson<SnapshotPayload>(
            FIND_SCRIPT,
            { title, name, role, maxResults: 50 },
            60_000,
          );
          if (!payload.ok) {
            throw new Error(`desktop: ${payload.error ?? "find failed"}`);
          }
          return {
            content: [{ type: "text" as const, text: formatSnapshot(payload) }],
            details: { window: payload.window, count: payload.elements?.length ?? 0 },
          };
        }
        case "screenshot": {
          const file = path.join(
            os.tmpdir(),
            `openclaw-desktop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`,
          );
          const annotate = params.annotate === true;
          const grid = params.grid === true;
          const windowOnly = params.window === true;
          const title = readStringParam(params, "title") || "";
          const marks = annotate
            ? [...lastRefs.entries()].slice(0, 150).map(([ref, entry]) => ({
                ref,
                x: entry.x,
                y: entry.y,
                w: entry.w,
                h: entry.h,
              }))
            : undefined;
          const payload = await runPowerShellJson<{
            ok: boolean;
            path: string;
            marked?: number;
            window?: boolean;
            title?: string;
            rect?: { x: number; y: number; w: number; h: number };
            hint?: string;
            error?: string;
            minimized?: boolean;
          }>(SCREENSHOT_SCRIPT, { path: file, marks, grid, window: windowOnly, title }, 30_000);
          if (!payload.ok) {
            // Window capture can fail recoverably (not found / minimized) — surface
            // the reason so the model can restore/focus and retry instead of giving up.
            return jsonResult({
              status: "error",
              error: payload.error ?? "screenshot failed",
              ...(payload.minimized ? { minimized: true } : {}),
            });
          }
          const extraParts: string[] = [];
          if (payload.window) {
            const r = payload.rect;
            extraParts.push(
              `Capture of window "${payload.title || title || "foreground"}"${
                r ? ` (screen ${r.x},${r.y}, size ${r.w}x${r.h})` : ""
              } — captured even though it need not be in the foreground. Image x,y are relative to the window's top-left; add the window's screen x,y to click on screen.`,
            );
            if (payload.hint) {
              extraParts.push(payload.hint);
            }
          } else {
            if (annotate) {
              extraParts.push(
                `Primary screen capture with ${payload.marked ?? 0} labeled boxes; labels match the refs from the latest snapshot (act kind=click ref=eN).`,
              );
            }
            if (grid) {
              extraParts.push(
                "A cyan coordinate grid is overlaid: lines every 100px, labels every 200px showing x,y. Read your target's position from the nearest labels and use act kind=click x=.. y=.. (screen coordinates).",
              );
            }
            if (extraParts.length === 0) {
              extraParts.push("Primary screen capture. Prefer snapshot (text) when possible.");
            }
          }
          return await imageResultFromFile({
            label: "desktop screenshot",
            path: payload.path,
            extraText: extraParts.join(" "),
          });
        }
        default:
          throw new Error(`desktop: unknown action "${action}".`);
      }
    },
  } as AnyAgentTool;
}
