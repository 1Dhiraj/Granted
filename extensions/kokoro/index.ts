import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { buildKokoroSpeechProvider } from "./kokoro-provider.js";

export default definePluginEntry({
  id: "kokoro",
  name: "Kokoro (local high-quality voice)",
  description:
    "Optional high-quality local neural TTS via an isolated worker — higher quality than Piper, heavier CPU",
  register(api) {
    api.registerSpeechProvider(buildKokoroSpeechProvider());
  },
});
