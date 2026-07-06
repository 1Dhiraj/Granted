import { html, nothing } from "lit";
import { ref } from "lit/directives/ref.js";
import { t } from "../../i18n/index.ts";
import { SLASH_COMMANDS } from "../chat/slash-commands.ts";
import { icons, type IconName } from "../icons.ts";
import { normalizeLowercaseStringOrEmpty } from "../string-coerce.ts";
import { FEATURE_INDEX, scoreFeature, type FeatureEntry } from "./feature-index.ts";

type PaletteItem = {
  id: string;
  label: string;
  icon: IconName;
  category: "pages" | "features" | "commands";
  action: string;
  description?: string;
  /** Extra match terms (synonyms) — searched but not displayed. */
  keywords?: string[];
};

function featureToItem(entry: FeatureEntry): PaletteItem {
  return {
    id: entry.id,
    label: entry.label,
    icon: entry.icon,
    category: entry.kind === "page" ? "pages" : "features",
    action: `nav:${entry.tab}`,
    description: entry.description,
    keywords: entry.keywords,
  };
}

const SLASH_PALETTE_ITEMS: PaletteItem[] = SLASH_COMMANDS.map((command) => ({
  id: `slash:${command.name}`,
  label: `/${command.name}`,
  icon: command.icon ?? "terminal",
  category: "commands",
  action: `/${command.name}`,
  description: command.description,
}));

const PALETTE_ITEMS: PaletteItem[] = [
  ...FEATURE_INDEX.map(featureToItem),
  ...SLASH_PALETTE_ITEMS,
];

export function getPaletteItems(): readonly PaletteItem[] {
  return PALETTE_ITEMS;
}

export type CommandPaletteProps = {
  open: boolean;
  query: string;
  activeIndex: number;
  onToggle: () => void;
  onQueryChange: (query: string) => void;
  onActiveIndexChange: (index: number) => void;
  onNavigate: (tab: string) => void;
  onSlashCommand: (command: string) => void;
};

const FEATURES_BY_ID = new Map(FEATURE_INDEX.map((entry) => [entry.id, entry]));

function scoreItem(item: PaletteItem, tokens: string[]): number {
  const feature = FEATURES_BY_ID.get(item.id);
  if (feature) {
    return scoreFeature(feature, tokens);
  }
  // Slash commands: match on name and description.
  const label = normalizeLowercaseStringOrEmpty(item.label);
  const description = normalizeLowercaseStringOrEmpty(item.description);
  let total = 0;
  for (const token of tokens) {
    let best = 0;
    if (label.startsWith(`/${token}`) || label.startsWith(token)) {
      best = 90;
    } else if (label.includes(token)) {
      best = 50;
    } else if (description.includes(token)) {
      best = 20;
    }
    if (best === 0) {
      return 0;
    }
    total += best;
  }
  return total;
}

function filteredItems(query: string): PaletteItem[] {
  const q = normalizeLowercaseStringOrEmpty(query).trim();
  if (!q) {
    return PALETTE_ITEMS;
  }
  const tokens = q.split(/\s+/).filter(Boolean);
  return PALETTE_ITEMS.map((item) => ({ item, score: scoreItem(item, tokens) }))
    .filter((entry) => entry.score > 0)
    .toSorted((a, b) => b.score - a.score)
    .slice(0, 40)
    .map((entry) => entry.item);
}

function groupItems(items: PaletteItem[]): Array<[string, PaletteItem[]]> {
  const map = new Map<string, PaletteItem[]>();
  for (const item of items) {
    const group = map.get(item.category) ?? [];
    group.push(item);
    map.set(item.category, group);
  }
  return [...map.entries()];
}

let previouslyFocused: Element | null = null;

function saveFocus() {
  previouslyFocused = document.activeElement;
}

function restoreFocus() {
  if (previouslyFocused && previouslyFocused instanceof HTMLElement) {
    requestAnimationFrame(() => previouslyFocused && (previouslyFocused as HTMLElement).focus());
  }
  previouslyFocused = null;
}

function selectItem(item: PaletteItem, props: CommandPaletteProps) {
  if (item.action.startsWith("nav:")) {
    props.onNavigate(item.action.slice(4));
  } else {
    props.onSlashCommand(item.action);
  }
  props.onToggle();
  restoreFocus();
}

function scrollActiveIntoView() {
  requestAnimationFrame(() => {
    const el = document.querySelector(".cmd-palette__item--active");
    el?.scrollIntoView({ block: "nearest" });
  });
}

function handleKeydown(e: KeyboardEvent, props: CommandPaletteProps) {
  const items = filteredItems(props.query);
  if (items.length === 0 && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter")) {
    return;
  }
  switch (e.key) {
    case "ArrowDown":
      e.preventDefault();
      props.onActiveIndexChange((props.activeIndex + 1) % items.length);
      scrollActiveIntoView();
      break;
    case "ArrowUp":
      e.preventDefault();
      props.onActiveIndexChange((props.activeIndex - 1 + items.length) % items.length);
      scrollActiveIntoView();
      break;
    case "Enter":
      e.preventDefault();
      if (items[props.activeIndex]) {
        selectItem(items[props.activeIndex], props);
      }
      break;
    case "Escape":
      e.preventDefault();
      props.onToggle();
      restoreFocus();
      break;
  }
}

const CATEGORY_LABELS: Record<string, string> = {
  pages: "Pages",
  features: "Features & settings",
  commands: "Chat commands",
};

function focusInput(el: Element | undefined) {
  if (el) {
    saveFocus();
    requestAnimationFrame(() => (el as HTMLInputElement).focus());
  }
}

export function renderCommandPalette(props: CommandPaletteProps) {
  if (!props.open) {
    return nothing;
  }

  const items = filteredItems(props.query);
  const grouped = groupItems(items);

  return html`
    <div
      class="cmd-palette-overlay"
      @click=${() => {
        props.onToggle();
        restoreFocus();
      }}
    >
      <div
        class="cmd-palette"
        @click=${(e: Event) => e.stopPropagation()}
        @keydown=${(e: KeyboardEvent) => handleKeydown(e, props)}
      >
        <input
          ${ref(focusInput)}
          class="cmd-palette__input"
          placeholder="${t("overview.palette.placeholder")}"
          .value=${props.query}
          @input=${(e: Event) => {
            props.onQueryChange((e.target as HTMLInputElement).value);
            props.onActiveIndexChange(0);
          }}
        />
        <div class="cmd-palette__results">
          ${grouped.length === 0
            ? html`<div class="cmd-palette__empty">
                <span class="nav-item__icon" style="opacity:0.3;width:20px;height:20px"
                  >${icons.search}</span
                >
                <span>${t("overview.palette.noResults")}</span>
                <span class="cmd-palette__empty-hint">${t("overview.palette.tryHint")}</span>
              </div>`
            : grouped.map(
                ([category, groupedItems]) => html`
                  <div class="cmd-palette__group-label">
                    ${CATEGORY_LABELS[category] ?? category}
                  </div>
                  ${groupedItems.map((item) => {
                    const globalIndex = items.indexOf(item);
                    const isActive = globalIndex === props.activeIndex;
                    return html`
                      <div
                        class="cmd-palette__item ${isActive ? "cmd-palette__item--active" : ""}"
                        @click=${(e: Event) => {
                          e.stopPropagation();
                          selectItem(item, props);
                        }}
                        @mouseenter=${() => props.onActiveIndexChange(globalIndex)}
                      >
                        <span class="nav-item__icon">${icons[item.icon]}</span>
                        <span class="cmd-palette__item-body">
                          <span class="cmd-palette__item-label">${item.label}</span>
                          ${item.description
                            ? html`<span class="cmd-palette__item-desc">${item.description}</span>`
                            : nothing}
                        </span>
                        ${item.action.startsWith("nav:")
                          ? html`<span class="cmd-palette__item-go">↵</span>`
                          : html`<span class="cmd-palette__item-go cmd-palette__item-go--cmd"
                              >chat</span
                            >`}
                      </div>
                    `;
                  })}
                `,
              )}
        </div>
        <div class="cmd-palette__footer">
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>↵</kbd> select</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  `;
}
