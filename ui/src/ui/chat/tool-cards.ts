import { html, nothing } from "lit";
import {
  isToolCallContentType,
  isToolResultContentType,
  resolveToolBlockArgs,
} from "../../../../src/chat/tool-content.js";
import { icons } from "../icons.ts";
import { formatToolDetail, resolveToolDisplay } from "../tool-display.ts";
import type { ToolCard } from "../types/chat-types.ts";
import { TOOL_INLINE_THRESHOLD } from "./constants.ts";
import { extractTextCached } from "./message-extract.ts";
import { isToolResultMessage } from "./message-normalizer.ts";
import { formatToolOutputForSidebar, getTruncatedPreview } from "./tool-helpers.ts";

export function extractToolCards(message: unknown): ToolCard[] {
  const m = message as Record<string, unknown>;
  const content = normalizeContent(m.content);
  const cards: ToolCard[] = [];

  for (const item of content) {
    const isToolCall =
      isToolCallContentType(item.type) ||
      (typeof item.name === "string" && resolveToolBlockArgs(item) != null);
    if (isToolCall) {
      cards.push({
        kind: "call",
        name: (item.name as string) ?? "tool",
        args: coerceArgs(resolveToolBlockArgs(item)),
      });
    }
  }

  for (const item of content) {
    if (!isToolResultContentType(item.type)) {
      continue;
    }
    const text = extractToolText(item);
    const name = typeof item.name === "string" ? item.name : "tool";
    cards.push({ kind: "result", name, text });
  }

  if (isToolResultMessage(message) && !cards.some((card) => card.kind === "result")) {
    const name =
      (typeof m.toolName === "string" && m.toolName) ||
      (typeof m.tool_name === "string" && m.tool_name) ||
      "tool";
    const text = extractTextCached(message) ?? undefined;
    cards.push({ kind: "result", name, text });
  }

  return cards;
}

type EditDiff = { oldText: string; newText: string };

const DIFF_MAX_LINES = 6;

/** Pull oldText/newText pairs out of edit-tool call args (flat or edits[] shape). */
function extractEditDiffs(name: string, args: unknown): EditDiff[] {
  if (name !== "edit") {
    return [];
  }
  const a = args as Record<string, unknown> | null | undefined;
  if (!a || typeof a !== "object") {
    return [];
  }
  const pairs: EditDiff[] = [];
  if (Array.isArray(a.edits)) {
    for (const entry of a.edits) {
      const e = entry as Record<string, unknown>;
      if (typeof e?.oldText === "string" && typeof e?.newText === "string") {
        pairs.push({ oldText: e.oldText, newText: e.newText });
      }
    }
  } else if (typeof a.oldText === "string" && typeof a.newText === "string") {
    pairs.push({ oldText: a.oldText, newText: a.newText });
  }
  return pairs;
}

function diffLines(text: string, sign: "-" | "+") {
  const lines = text.split("\n");
  const shown = lines.slice(0, DIFF_MAX_LINES);
  const truncated = lines.length > DIFF_MAX_LINES;
  const color = sign === "-" ? "var(--danger, #f87171)" : "var(--success, #4ade80)";
  return html`${shown.map(
    (line) => html`<div style="color:${color}">${sign} ${line}</div>`,
  )}${truncated ? html`<div class="muted">${sign} … ${lines.length - DIFF_MAX_LINES} more</div>` : nothing}`;
}

function renderEditDiff(diffs: EditDiff[]) {
  if (diffs.length === 0) {
    return nothing;
  }
  return html`<div class="chat-tool-card__preview mono" style="white-space:pre-wrap">
    ${diffs.map(
      (d) => html`${diffLines(d.oldText, "-")}${diffLines(d.newText, "+")}`,
    )}
  </div>`;
}

export function renderToolCardSidebar(card: ToolCard, onOpenSidebar?: (content: string) => void) {
  const display = resolveToolDisplay({ name: card.name, args: card.args });
  const detail = formatToolDetail(display);
  const hasText = Boolean(card.text?.trim());
  const editDiffs = card.kind === "call" ? extractEditDiffs(card.name, card.args) : [];

  const canClick = Boolean(onOpenSidebar);
  const handleClick = canClick
    ? () => {
        if (hasText) {
          onOpenSidebar!(formatToolOutputForSidebar(card.text!));
          return;
        }
        const info = `## ${display.label}\n\n${
          detail ? `**Command:** \`${detail}\`\n\n` : ""
        }*No output — tool completed successfully.*`;
        onOpenSidebar!(info);
      }
    : undefined;

  const isShort = hasText && (card.text?.length ?? 0) <= TOOL_INLINE_THRESHOLD;
  const showCollapsed = hasText && !isShort;
  const showInline = hasText && isShort;
  const isEmpty = !hasText;

  return html`
    <div
      class="chat-tool-card ${canClick ? "chat-tool-card--clickable" : ""}"
      @click=${handleClick}
      role=${canClick ? "button" : nothing}
      tabindex=${canClick ? "0" : nothing}
      @keydown=${canClick
        ? (e: KeyboardEvent) => {
            if (e.key !== "Enter" && e.key !== " ") {
              return;
            }
            e.preventDefault();
            handleClick?.();
          }
        : nothing}
    >
      <div class="chat-tool-card__header">
        <div class="chat-tool-card__title">
          <span class="chat-tool-card__icon">${icons[display.icon]}</span>
          <span>${display.label}</span>
        </div>
        ${canClick
          ? html`<span class="chat-tool-card__action"
              >${hasText ? "View" : ""} ${icons.check}</span
            >`
          : nothing}
        ${isEmpty && !canClick
          ? html`<span class="chat-tool-card__status">${icons.check}</span>`
          : nothing}
      </div>
      ${detail ? html`<div class="chat-tool-card__detail">${detail}</div>` : nothing}
      ${renderEditDiff(editDiffs)}
      ${isEmpty ? html` <div class="chat-tool-card__status-text muted">Completed</div> ` : nothing}
      ${showCollapsed
        ? html`<div class="chat-tool-card__preview mono">${getTruncatedPreview(card.text!)}</div>`
        : nothing}
      ${showInline ? html`<div class="chat-tool-card__inline mono">${card.text}</div>` : nothing}
    </div>
  `;
}

function normalizeContent(content: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(content)) {
    return [];
  }
  return content.filter(Boolean) as Array<Record<string, unknown>>;
}

function coerceArgs(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return value;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function extractToolText(item: Record<string, unknown>): string | undefined {
  if (typeof item.text === "string") {
    return item.text;
  }
  if (typeof item.content === "string") {
    return item.content;
  }
  return undefined;
}
