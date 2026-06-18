import { html, nothing } from "lit";
import { icons } from "../icons.ts";

// ── Types ─────────────────────────────────────────────────────────────────

export type ProviderItem = {
  id: string;
  label: string;
  description: string;
  authType: "api_key" | "url" | "none";
  docsUrl: string;
  keyHint: string;
  configured: boolean;
  maskedKey?: string;
  metaUrl?: string;
};

export type OllamaModel = {
  id: string;
  label: string;
  provider: string;
  family: string | null;
  parameterSize: string | null;
};

export type ProvidersProps = {
  connected: boolean;
  loading: boolean;
  providers: ProviderItem[];
  error: string | null;
  // per-provider edit state: key input values
  edits: Record<string, string>;
  // which provider card has its input open
  openId: string | null;
  // which provider is currently saving
  savingId: string | null;
  // per-provider feedback messages
  messages: Record<string, { kind: "success" | "error"; text: string }>;
  // ollama models result
  ollamaModels: OllamaModel[] | null;
  ollamaLoading: boolean;
  ollamaError: string | null;
  // callbacks
  onRefresh: () => void;
  onEditChange: (providerId: string, value: string) => void;
  onToggleOpen: (providerId: string) => void;
  onSave: (providerId: string) => void;
  onDelete: (providerId: string) => void;
  onTestOllama: (providerId: string) => void;
};

// ── Provider emoji/icon mapping ───────────────────────────────────────────

const PROVIDER_EMOJI: Record<string, string> = {
  anthropic: "🟠",
  openai: "⚫",
  google: "🔵",
  mistral: "🟣",
  groq: "⚡",
  deepseek: "🌊",
  together: "🤝",
  openrouter: "🔀",
  perplexity: "🔍",
  nvidia: "🟢",
  xai: "✖️",
  fireworks: "🎆",
  huggingface: "🤗",
  ollama: "🦙",
};

function providerEmoji(id: string): string {
  return PROVIDER_EMOJI[id] ?? "🤖";
}

// ── Render ────────────────────────────────────────────────────────────────

function renderProviderCard(provider: ProviderItem, props: ProvidersProps) {
  const isOpen = props.openId === provider.id;
  const isSaving = props.savingId === provider.id;
  const editValue = props.edits[provider.id] ?? "";
  const message = props.messages[provider.id];
  const isLocalProvider = provider.authType === "url";
  const defaultUrl = "http://127.0.0.1:11434";

  const configuredLabel = isLocalProvider
    ? `Connected — ${provider.metaUrl ?? defaultUrl}`
    : provider.configured
      ? `Key saved — ${provider.maskedKey ?? "****"}`
      : "Not configured";

  return html`
    <div class="provider-card ${provider.configured ? "provider-card--configured" : ""}">
      <div class="provider-card__header">
        <div class="provider-card__icon-wrap">
          <span class="provider-card__emoji" aria-hidden="true">${providerEmoji(provider.id)}</span>
          <span
            class="provider-card__dot ${provider.configured ? "provider-card__dot--on" : "provider-card__dot--off"}"
            title="${provider.configured ? "API key configured" : "No API key set"}"
          ></span>
        </div>
        <div class="provider-card__info">
          <div class="provider-card__name">
            ${provider.label}
            ${provider.configured
              ? html`<span class="provider-card__status-text provider-card__status-text--on">● Active</span>`
              : html`<span class="provider-card__status-text provider-card__status-text--off">○ Not set</span>`}
          </div>
          <div class="provider-card__desc">${provider.description}</div>
          ${provider.configured
            ? html`<div class="provider-card__status">${configuredLabel}</div>`
            : nothing}
        </div>
        <div class="provider-card__actions">
          ${provider.docsUrl
            ? html`
                <a
                  class="btn btn--subtle btn--sm"
                  href="${provider.docsUrl}"
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Get API key (opens docs)"
                >
                  ${icons.externalLink}
                </a>
              `
            : nothing}
          ${provider.configured
            ? html`
                <button
                  class="btn btn--subtle btn--sm"
                  title="Remove key"
                  ?disabled=${isSaving}
                  @click=${() => props.onDelete(provider.id)}
                >
                  ${icons.trash}
                </button>
              `
            : nothing}
          <button
            class="btn btn--sm ${isOpen ? "btn--subtle" : "btn--primary"}"
            ?disabled=${isSaving}
            @click=${() => props.onToggleOpen(provider.id)}
          >
            ${isOpen ? "Cancel" : provider.configured ? "Update" : isLocalProvider ? "Configure" : "Set Key"}
          </button>
        </div>
      </div>

      ${isOpen
        ? html`
            <div class="provider-card__edit">
              ${isLocalProvider
                ? html`
                    <div class="provider-card__field">
                      <label class="provider-card__label">Server URL</label>
                      <div class="provider-card__input-row">
                        <input
                          class="input provider-card__input"
                          type="url"
                          placeholder="${defaultUrl}"
                          .value=${editValue || provider.metaUrl || defaultUrl}
                          @input=${(e: Event) =>
                            props.onEditChange(
                              provider.id,
                              (e.target as HTMLInputElement).value,
                            )}
                          @keydown=${(e: KeyboardEvent) => {
                            if (e.key === "Enter") props.onSave(provider.id);
                          }}
                        />
                        <button
                          class="btn btn--primary btn--sm"
                          ?disabled=${isSaving}
                          @click=${() => props.onSave(provider.id)}
                        >
                          ${isSaving ? "Saving…" : "Save"}
                        </button>
                      </div>
                      <p class="provider-card__hint">
                        Default is <code>${defaultUrl}</code>. Change this if the server
                        runs on a different port or host.
                      </p>
                    </div>
                  `
                : html`
                    <div class="provider-card__field">
                      <label class="provider-card__label">API Key</label>
                      <div class="provider-card__input-row">
                        <input
                          class="input provider-card__input"
                          type="password"
                          placeholder="${provider.keyHint}"
                          autocomplete="new-password"
                          .value=${editValue}
                          @input=${(e: Event) =>
                            props.onEditChange(
                              provider.id,
                              (e.target as HTMLInputElement).value,
                            )}
                          @keydown=${(e: KeyboardEvent) => {
                            if (e.key === "Enter") props.onSave(provider.id);
                          }}
                        />
                        <button
                          class="btn btn--primary btn--sm"
                          ?disabled=${isSaving || !editValue.trim()}
                          @click=${() => props.onSave(provider.id)}
                        >
                          ${isSaving ? "Saving…" : "Save"}
                        </button>
                      </div>
                      <p class="provider-card__hint">
                        Stored securely in <code>~/.openclaw/</code> on your local machine.
                        Never sent anywhere except the provider's API.
                      </p>
                    </div>
                  `}
            </div>
          `
        : nothing}

      ${message
        ? html`
            <div class="provider-card__message provider-card__message--${message.kind}">
              ${message.kind === "success" ? icons.check : icons.x}
              <span>${message.text}</span>
            </div>
          `
        : nothing}

      ${isLocalProvider && provider.configured
        ? html`
            <div class="provider-card__ollama">
              <div class="provider-card__ollama-header">
                <span class="provider-card__ollama-title">Local Models</span>
                <button
                  class="btn btn--subtle btn--sm"
                  ?disabled=${props.ollamaLoading}
                  @click=${() => props.onTestOllama(provider.id)}
                >
                  ${props.ollamaLoading ? html`${icons.loader} Detecting…` : html`${icons.refresh} Detect`}
                </button>
              </div>
              ${props.ollamaError
                ? html`
                    <div class="callout danger provider-card__ollama-error">
                      ${props.ollamaError}
                    </div>
                  `
                : nothing}
              ${props.ollamaModels !== null
                ? props.ollamaModels.length === 0
                  ? html`<p class="provider-card__ollama-empty">
                      No models found. Pull one with <code>ollama pull llama3</code>.
                    </p>`
                  : html`
                      <div class="provider-card__ollama-models">
                        ${props.ollamaModels.map(
                          (m) => html`
                            <div class="provider-card__ollama-model">
                              <span class="provider-card__ollama-model-name">${m.label}</span>
                              ${m.parameterSize
                                ? html`<span class="pill provider-card__ollama-size"
                                    >${m.parameterSize}</span
                                  >`
                                : nothing}
                              ${m.family
                                ? html`<span class="provider-card__ollama-family">${m.family}</span>`
                                : nothing}
                            </div>
                          `,
                        )}
                      </div>
                    `
                : nothing}
            </div>
          `
        : nothing}
    </div>
  `;
}

export function renderProviders(props: ProvidersProps) {
  if (!props.connected) {
    return html`<div class="callout">Not connected to gateway.</div>`;
  }

  if (props.loading) {
    return html`<div class="loading-state">${icons.loader} Loading providers…</div>`;
  }

  if (props.error) {
    return html`
      <div class="callout danger">
        <strong>Error:</strong> ${props.error}
        <button class="btn btn--subtle btn--sm" @click=${props.onRefresh}>Retry</button>
      </div>
    `;
  }

  const cloudProviders = props.providers.filter((p) => p.authType === "api_key");
  const localProviders = props.providers.filter((p) => p.authType !== "api_key");

  return html`
    <div class="providers-page">
      <div class="providers-intro callout">
        <strong>API keys are stored locally</strong> in
        <code>~/.openclaw/auth-profiles.json</code> on your machine — never in the cloud or
        shared with anyone. Keys are write-only from the UI (they display masked after saving).
      </div>

      <section class="providers-section">
        <h3 class="providers-section__title">Cloud Providers</h3>
        <div class="providers-grid">
          ${cloudProviders.map((p) => renderProviderCard(p, props))}
        </div>
      </section>

      <section class="providers-section">
        <h3 class="providers-section__title">Local Models</h3>
        <div class="providers-grid">
          ${localProviders.map((p) => renderProviderCard(p, props))}
          ${localProviders.length === 0
            ? html`<p class="providers-empty">No local providers available.</p>`
            : nothing}
        </div>
      </section>
    </div>
  `;
}
