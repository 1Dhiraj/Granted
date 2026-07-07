import { describe, expect, it } from "vitest";
import { buildGoogleRealtimeVoiceProvider } from "./realtime-voice-provider.js";

describe("buildGoogleRealtimeVoiceProvider", () => {
  it("normalizes provider-owned voice settings from raw provider config", () => {
    const provider = buildGoogleRealtimeVoiceProvider();
    const resolved = provider.resolveConfig?.({
      cfg: {} as never,
      rawConfig: {
        providers: {
          google: {
            model: "gemini-3.1-flash-live-preview",
            voice: "Aoede",
            temperature: 0.6,
          },
        },
      },
    });

    expect(resolved).toEqual({
      model: "gemini-3.1-flash-live-preview",
      voice: "Aoede",
      temperature: 0.6,
    });
  });

  it("reports configured when an api key is present in provider config", () => {
    const provider = buildGoogleRealtimeVoiceProvider();
    expect(
      provider.isConfigured?.({
        providerConfig: { providers: { google: { apiKey: "test-key" } } },
      }),
    ).toBe(true);
  });
});
