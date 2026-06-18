import type { GatewayBrowserClient } from "../gateway.ts";
import type { OllamaModel, ProviderItem } from "../views/providers.ts";

export type ProvidersState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  providersLoading: boolean;
  providersList: ProviderItem[];
  providersError: string | null;
  providersEdits: Record<string, string>;
  providersOpenId: string | null;
  providersSavingId: string | null;
  providersMessages: Record<string, { kind: "success" | "error"; text: string }>;
  ollamaModels: OllamaModel[] | null;
  ollamaLoading: boolean;
  ollamaError: string | null;
};

function setMessage(
  state: ProvidersState,
  id: string,
  msg?: { kind: "success" | "error"; text: string },
) {
  const next = { ...state.providersMessages };
  if (msg) {
    next[id] = msg;
  } else {
    delete next[id];
  }
  state.providersMessages = next;
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export async function loadProviders(state: ProvidersState): Promise<void> {
  if (!state.client || !state.connected) return;
  state.providersLoading = true;
  state.providersError = null;
  try {
    const res = await state.client.request<{ providers: ProviderItem[] }>("providers.list", {});
    state.providersList = res.providers ?? [];
  } catch (err) {
    state.providersError = getErrorMessage(err);
  } finally {
    state.providersLoading = false;
  }
}

export async function saveProviderKey(
  state: ProvidersState,
  providerId: string,
): Promise<void> {
  if (!state.client || !state.connected) return;
  state.providersSavingId = providerId;
  setMessage(state, providerId);
  try {
    const provider = state.providersList.find((p) => p.id === providerId);
    const editValue = state.providersEdits[providerId] ?? "";

    if (provider?.authType === "url") {
      const baseUrl = editValue.trim() || provider.metaUrl || "http://127.0.0.1:11434";
      await state.client.request("providers.setKey", { providerId, baseUrl });
    } else {
      if (!editValue.trim()) return;
      await state.client.request("providers.setKey", { providerId, key: editValue.trim() });
    }

    // Clear the edit input and close the panel
    const nextEdits = { ...state.providersEdits };
    delete nextEdits[providerId];
    state.providersEdits = nextEdits;
    state.providersOpenId = null;

    setMessage(state, providerId, { kind: "success", text: "Key saved." });
    await loadProviders(state);

    // Auto-clear success message after 3 seconds
    setTimeout(() => setMessage(state, providerId), 3000);
  } catch (err) {
    setMessage(state, providerId, { kind: "error", text: getErrorMessage(err) });
  } finally {
    state.providersSavingId = null;
  }
}

export async function deleteProviderKey(
  state: ProvidersState,
  providerId: string,
): Promise<void> {
  if (!state.client || !state.connected) return;
  state.providersSavingId = providerId;
  setMessage(state, providerId);
  try {
    await state.client.request("providers.deleteKey", { providerId });
    setMessage(state, providerId, { kind: "success", text: "Key removed." });
    await loadProviders(state);
    setTimeout(() => setMessage(state, providerId), 3000);
  } catch (err) {
    setMessage(state, providerId, { kind: "error", text: getErrorMessage(err) });
  } finally {
    state.providersSavingId = null;
  }
}

export async function listOllamaModels(state: ProvidersState, providerId: string): Promise<void> {
  if (!state.client || !state.connected) return;
  state.ollamaLoading = true;
  state.ollamaError = null;
  try {
    const res = await state.client.request<{ models: OllamaModel[]; baseUrl?: string }>(
      "providers.listModels",
      { providerId },
    );
    state.ollamaModels = res.models ?? [];
  } catch (err) {
    state.ollamaError = getErrorMessage(err);
    state.ollamaModels = null;
  } finally {
    state.ollamaLoading = false;
  }
}
