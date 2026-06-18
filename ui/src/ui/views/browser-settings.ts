import { html, nothing, type TemplateResult } from "lit";
import type { BrowserToolSchemaMode, BrowserSettingsState } from "../controllers/browser-settings.ts";

export type BrowserSettingsProps = {
  state: BrowserSettingsState;
  onModeChange: (mode: BrowserToolSchemaMode) => void;
};

export function renderBrowserSettings(props: BrowserSettingsProps): TemplateResult {
  const { state, onModeChange } = props;
  const { loading, error, schemaMode, saving } = state;

  const isFullMode = schemaMode === "full";
  const isSimplifiedMode = schemaMode === "simplified";

  const handleToggle = (mode: BrowserToolSchemaMode) => {
    if (!saving) {
      onModeChange(mode);
    }
  };

  return html`
    <div class="browser-settings" style="padding: 16px; border-radius: 8px; background: var(--surface-secondary, #f5f5f5);">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
        <div>
          <h3 style="margin: 0 0 4px 0; font-size: 14px; font-weight: 600;">Browser Tool Schema</h3>
          <p style="margin: 0; font-size: 12px; color: var(--text-secondary, #666);">
            Choose a schema based on your model type
          </p>
        </div>
        ${loading ? html`<span style="color: var(--text-secondary, #666);">Loading…</span>` : nothing}
      </div>

      ${error ? html`<div style="color: #d32f2f; font-size: 12px; margin-bottom: 8px;">${error}</div>` : nothing}

      <div style="display: flex; gap: 8px; margin-bottom: 12px;">
        <button
          style="${isFullMode
            ? 'background: var(--primary, #1976d2); color: white;'
            : 'background: var(--surface-tertiary, #e0e0e0); color: var(--text-primary, #000);'} padding: 8px 16px; border: none; border-radius: 4px; cursor: ${saving ? 'not-allowed' : 'pointer'}; opacity: ${saving ? '0.6' : '1'}; font-size: 12px; font-weight: 500; transition: all 200ms;"
          ?disabled=${saving}
          @click="${() => handleToggle('full')}"
        >
          ${saving && isFullMode ? html`Saving…` : html`Full (30+ params)`}
        </button>
        <button
          style="${isSimplifiedMode
            ? 'background: var(--primary, #1976d2); color: white;'
            : 'background: var(--surface-tertiary, #e0e0e0); color: var(--text-primary, #000);'} padding: 8px 16px; border: none; border-radius: 4px; cursor: ${saving ? 'not-allowed' : 'pointer'}; opacity: ${saving ? '0.6' : '1'}; font-size: 12px; font-weight: 500; transition: all 200ms;"
          ?disabled=${saving}
          @click="${() => handleToggle('simplified')}"
        >
          ${saving && isSimplifiedMode ? html`Saving…` : html`Simplified (4 params)`}
        </button>
      </div>

      <div style="font-size: 11px; color: var(--text-secondary, #666); line-height: 1.5;">
        <div style="margin-bottom: 8px;">
          <strong>Full Schema:</strong> Best for Claude, GPT, and powerful models. Supports all advanced browser operations.
        </div>
        <div>
          <strong>Simplified Schema:</strong> Best for Ollama, NVIDIA, and local models. Simpler to understand but requires more tool calls.
        </div>
      </div>
    </div>
  `;
}
