import { html, type TemplateResult } from "lit";

export type BrowserToolSettingsProps = {
  currentMode: "full" | "simplified";
  isSaving: boolean;
  error: string | null;
  onToggle: (mode: "full" | "simplified") => void;
};

const checkItem = (text: string) => html`
  <div style="display: flex; align-items: flex-start; gap: 8px; margin-bottom: 4px;">
    <span style="color: var(--accent); font-weight: 700; line-height: 1.6;">✓</span>
    <span>${text}</span>
  </div>
`;

const noteItem = (text: string) => html`
  <div style="display: flex; align-items: flex-start; gap: 8px; margin-bottom: 4px;">
    <span style="color: var(--muted); font-weight: 700; line-height: 1.6;">—</span>
    <span>${text}</span>
  </div>
`;

export function renderBrowserToolSettings(props: BrowserToolSettingsProps): TemplateResult {
  const { currentMode, isSaving, error, onToggle } = props;

  const cardBase =
    "padding: 16px; border-radius: var(--radius-md); cursor: pointer; font-size: 14px; font-weight: 600; transition: all 200ms; text-align: left;";
  const cardActive =
    "background: var(--primary); color: var(--primary-foreground); border: 2px solid var(--primary);";
  const cardInactive =
    "background: transparent; color: var(--text); border: 2px solid var(--border);";

  return html`
    <div style="padding: 24px; max-width: 600px;">
      <div style="margin-bottom: 24px;">
        <h2 style="margin: 0 0 8px 0; font-size: 24px; font-weight: 600; color: var(--text-strong);">
          Browser Tool Schema
        </h2>
        <p style="margin: 0; font-size: 14px; color: var(--muted);">
          Choose the tool schema that works best with your model
        </p>
      </div>

      ${error
        ? html`<div
            style="color: var(--danger); font-size: 13px; margin-bottom: 16px; padding: 12px; background: var(--danger-subtle); border-radius: var(--radius-sm);"
          >
            ${error}
          </div>`
        : ""}

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 24px;">
        <button
          style="${currentMode === "full" ? cardActive : cardInactive} ${cardBase} opacity: ${isSaving
            ? "0.6"
            : "1"};"
          ?disabled=${isSaving}
          @click="${() => !isSaving && onToggle("full")}"
        >
          <div style="font-size: 16px; margin-bottom: 8px;">Full Schema</div>
          <div style="font-size: 12px; opacity: 0.8; line-height: 1.4;">
            30+ parameters<br />
            Best for Claude &amp; GPT
          </div>
        </button>

        <button
          style="${currentMode === "simplified"
            ? cardActive
            : cardInactive} ${cardBase} opacity: ${isSaving ? "0.6" : "1"};"
          ?disabled=${isSaving}
          @click="${() => !isSaving && onToggle("simplified")}"
        >
          <div style="font-size: 16px; margin-bottom: 8px;">Simplified</div>
          <div style="font-size: 12px; opacity: 0.8; line-height: 1.4;">
            4 parameters<br />
            Best for Ollama &amp; local models
          </div>
        </button>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
        <div
          style="padding: 12px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-sm); font-size: 12px; line-height: 1.6; color: var(--text);"
        >
          <div style="font-weight: 600; margin-bottom: 6px; color: var(--text-strong);">
            Full Schema
          </div>
          ${checkItem("All 30+ parameters")} ${checkItem("Supports advanced features")}
          ${checkItem("Efficient (fewer calls)")} ${noteItem("Complex for local models")}
        </div>

        <div
          style="padding: 12px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-sm); font-size: 12px; line-height: 1.6; color: var(--text);"
        >
          <div style="font-weight: 600; margin-bottom: 6px; color: var(--text-strong);">
            Simplified
          </div>
          ${checkItem("Just 4 core parameters")} ${checkItem("Easy for local models")}
          ${checkItem("Highly reliable")} ${noteItem("More tool calls needed")}
        </div>
      </div>

      <div
        style="margin-top: 24px; padding: 12px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-sm); font-size: 12px; color: var(--muted); line-height: 1.6;"
      >
        <strong style="color: var(--text);">Note:</strong> The selected schema will be used for all
        browser tool calls. You need to restart the gateway for changes to take effect.
      </div>

      ${isSaving
        ? html`<div
            style="margin-top: 16px; text-align: center; color: var(--accent); font-size: 13px;"
          >
            Saving…
          </div>`
        : ""}
    </div>
  `;
}
