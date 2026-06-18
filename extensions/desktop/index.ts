import { definePluginEntry, type AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import { createDesktopTool } from "./src/desktop-tool.js";

export default definePluginEntry({
  id: "desktop",
  name: "Desktop",
  description: "Windows desktop automation: UI Automation snapshots plus mouse/keyboard control",
  register(api) {
    const pluginConfig = (api.pluginConfig ?? {}) as {
      maxSnapshotElements?: number;
      maxSnapshotDepth?: number;
    };
    api.registerTool(
      createDesktopTool({
        maxSnapshotElements: pluginConfig.maxSnapshotElements,
        maxSnapshotDepth: pluginConfig.maxSnapshotDepth,
      }) as AnyAgentTool,
    );
  },
});
