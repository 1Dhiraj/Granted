import { html, type TemplateResult } from "lit";

export type BrowserToolSettingsProps = {
  currentMode: "full" | "simplified";
  isSaving: boolean;
  error: string | null;
  onToggle: (mode: "full" | "simplified") => void;
};

export function renderBrowserToolSettings(props: BrowserToolSettingsProps): TemplateResult {
  const { currentMode, isSaving, error, onToggle } = props;

  return html`
    <div style="padding: 24px; max-width: 600px;">
      <div style="margin-bottom: 24px;">
        <h2 style="margin: 0 0 8px 0; font-size: 24px; font-weight: 600;">Browser Tool Schema</h2>
        <p style="margin: 0; font-size: 14px; color: var(--text-secondary, #666);">
          Choose the tool schema that works best with your model
        </p>
      </div>

      ${error ? html`<div style="color: #d32f2f; font-size: 13px; margin-bottom: 16px; padding: 12px; background: rgba(211,47,47,0.1); border-radius: 4px;">${error}</div>` : ""}

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 24px;">
        <!-- Full Schema Button -->
        <button
          style="${currentMode === 'full'
            ? 'background: var(--primary, #1976d2); color: white; border: 2px solid var(--primary, #1976d2);'
            : 'background: transparent; color: var(--text-primary, #000); border: 2px solid var(--border, #ddd);'} padding: 16px; border-radius: 8px; cursor: ${isSaving ? 'not-allowed' : 'pointer'}; opacity: ${isSaving ? '0.6' : '1'}; font-size: 14px; font-weight: 600; transition: all 200ms; text-align: left;"
          ?disabled=${isSaving}
          @click="${() => !isSaving && onToggle('full')}"
        >
          <div style="font-size: 16px; margin-bottom: 8px;">📋 Full Schema</div>
          <div style="font-size: 12px; opacity: 0.8; line-height: 1.4;">
            30+ parameters<br/>
            Best for Claude & GPT
          </div>
        </button>

        <!-- Simplified Schema Button -->
        <button
          style="${currentMode === 'simplified'
            ? 'background: var(--primary, #1976d2); color: white; border: 2px solid var(--primary, #1976d2);'
            : 'background: transparent; color: var(--text-primary, #000); border: 2px solid var(--border, #ddd);'} padding: 16px; border-radius: 8px; cursor: ${isSaving ? 'not-allowed' : 'pointer'}; opacity: ${isSaving ? '0.6' : '1'}; font-size: 14px; font-weight: 600; transition: all 200ms; text-align: left;"
          ?disabled=${isSaving}
          @click="${() => !isSaving && onToggle('simplified')}"
        >
          <div style="font-size: 16px; margin-bottom: 8px;">⚡ Simplified</div>
          <div style="font-size: 12px; opacity: 0.8; line-height: 1.4;">
            4 parameters<br/>
            Best for Ollama & local models
          </div>
        </button>
      </div>

      <!-- Info Boxes -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
        <!-- Full Schema Info -->
        <div style="padding: 12px; background: var(--surface-secondary, #f5f5f5); border-radius: 6px; font-size: 12px; line-height: 1.6;">
          <div style="font-weight: 600; margin-bottom: 6px;">📋 Full Schema</div>
          <div>
            ✅ All 30+ parameters<br/>
            ✅ Supports advanced features<br/>
            ✅ Efficient (fewer calls)<br/>
            ⚠️ Complex for local models
          </div>
        </div>

        <!-- Simplified Schema Info -->
        <div style="padding: 12px; background: var(--surface-secondary, #f5f5f5); border-radius: 6px; font-size: 12px; line-height: 1.6;">
          <div style="font-weight: 600; margin-bottom: 6px;">⚡ Simplified</div>
          <div>
            ✅ Just 4 core parameters<br/>
            ✅ Easy for local models<br/>
            ✅ More tool calls needed<br/>
            ✅ Highly reliable
          </div>
        </div>
      </div>

      <div style="margin-top: 24px; padding: 12px; background: var(--surface-secondary, #f5f5f5); border-radius: 6px; font-size: 12px; color: var(--text-secondary, #666); line-height: 1.6;">
        <strong>ℹ️ Note:</strong> The selected schema will be used for all browser tool calls. You need to restart the gateway for changes to take effect.
      </div>

      ${isSaving ? html`<div style="margin-top: 16px; text-align: center; color: var(--primary, #1976d2); font-size: 13px;">Saving...</div>` : ""}
    </div>
  `;
}
