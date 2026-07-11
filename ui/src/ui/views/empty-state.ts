import { html, nothing, type TemplateResult } from "lit";
import { icons, type IconName } from "../icons.ts";

export type EmptyStateProps = {
  icon: IconName;
  title: string;
  /** One short sentence explaining what would fill this space. */
  hint?: string;
  /** Optional call-to-action rendered under the hint. */
  action?: TemplateResult;
};

/**
 * Shared friendly empty state for lists and tables. Keeps "nothing here yet"
 * moments calm and actionable instead of a bare "No X found." string.
 */
export function renderEmptyState(props: EmptyStateProps) {
  return html`
    <div class="empty-state">
      <div class="empty-state__icon" aria-hidden="true">${icons[props.icon]}</div>
      <div class="empty-state__title">${props.title}</div>
      ${props.hint ? html`<div class="empty-state__hint">${props.hint}</div>` : nothing}
      ${props.action ? html`<div class="empty-state__action">${props.action}</div>` : nothing}
    </div>
  `;
}
