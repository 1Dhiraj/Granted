import { gatewayClient } from "../gateway-client.ts";

export type BrowserToolSchemaMode = "full" | "simplified";

export type BrowserSettingsState = {
  loading: boolean;
  error: string | null;
  schemaMode: BrowserToolSchemaMode;
  saving: boolean;
};

export async function loadBrowserSettings(
  onUpdate: (state: BrowserSettingsState) => void,
): Promise<void> {
  onUpdate({ loading: true, error: null, schemaMode: "full", saving: false });

  try {
    const config = await gatewayClient.call("config.load");
    const mode =
      (config?.tools?.browser?.schema as BrowserToolSchemaMode | undefined) ?? "full";
    onUpdate({ loading: false, error: null, schemaMode: mode, saving: false });
  } catch (err) {
    onUpdate({
      loading: false,
      error: String(err),
      schemaMode: "full",
      saving: false,
    });
  }
}

export async function saveBrowserSchemaMode(
  mode: BrowserToolSchemaMode,
  onUpdate: (state: BrowserSettingsState) => void,
): Promise<void> {
  onUpdate({ loading: false, error: null, schemaMode: mode, saving: true });

  try {
    const config = await gatewayClient.call("config.load");
    const updated = {
      ...config,
      tools: {
        ...(config?.tools ?? {}),
        browser: {
          ...(config?.tools?.browser ?? {}),
          schema: mode,
        },
      },
    };

    await gatewayClient.call("config.apply", { value: updated });
    onUpdate({ loading: false, error: null, schemaMode: mode, saving: false });
  } catch (err) {
    onUpdate({
      loading: false,
      error: String(err),
      schemaMode: mode,
      saving: false,
    });
  }
}
