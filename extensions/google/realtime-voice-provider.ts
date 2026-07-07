import type {
  RealtimeVoiceBridge,
  RealtimeVoiceBridgeCreateRequest,
  RealtimeVoiceProviderConfig,
  RealtimeVoiceProviderPlugin,
  RealtimeVoiceTool,
} from "openclaw/plugin-sdk/realtime-voice";
import { normalizeResolvedSecretInputString } from "openclaw/plugin-sdk/secret-input";
import { normalizeOptionalString } from "openclaw/plugin-sdk/text-runtime";
import WebSocket from "ws";
import { muLaw8kToPcm16k, pcm24kToMuLaw8k } from "./realtime-voice-audio.js";

const LIVE_WS_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

type GoogleRealtimeVoiceProviderConfig = {
  apiKey?: string;
  model?: string;
  voice?: string;
  temperature?: number;
};

type GoogleRealtimeVoiceBridgeConfig = RealtimeVoiceBridgeCreateRequest & {
  apiKey: string;
  model?: string;
  voice?: string;
  temperature?: number;
};

type LiveServerContent = {
  modelTurn?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> };
  inputTranscription?: { text?: string };
  outputTranscription?: { text?: string };
  interrupted?: boolean;
  turnComplete?: boolean;
  generationComplete?: boolean;
};

type LiveServerMessage = {
  setupComplete?: Record<string, unknown>;
  serverContent?: LiveServerContent;
  toolCall?: { functionCalls?: Array<{ id?: string; name?: string; args?: unknown }> };
  toolCallCancellation?: { ids?: string[] };
  goAway?: { timeLeft?: string };
  error?: unknown;
};

function asObjectRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function resolveGoogleProviderConfigRecord(
  config: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const providers = asObjectRecord(config.providers);
  return (
    asObjectRecord(providers?.google) ?? asObjectRecord(config.google) ?? asObjectRecord(config)
  );
}

function normalizeProviderConfig(
  config: RealtimeVoiceProviderConfig,
): GoogleRealtimeVoiceProviderConfig {
  const raw = resolveGoogleProviderConfigRecord(config);
  return {
    apiKey: normalizeResolvedSecretInputString({
      value: raw?.apiKey,
      path: "plugins.entries.voice-call.config.realtime.providers.google.apiKey",
    }),
    model: normalizeOptionalString(raw?.model),
    voice: normalizeOptionalString(raw?.voice),
    temperature: asFiniteNumber(raw?.temperature),
  };
}

function resolveEnvApiKey(): string | undefined {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || undefined;
}

function toModelPath(model: string): string {
  return model.startsWith("models/") ? model : `models/${model}`;
}

function toFunctionDeclarations(tools: RealtimeVoiceTool[] | undefined) {
  if (!tools || tools.length === 0) {
    return undefined;
  }
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      })),
    },
  ];
}

class GoogleRealtimeVoiceBridge implements RealtimeVoiceBridge {
  private static readonly DEFAULT_MODEL = "gemini-3.1-flash-live-preview";
  private static readonly DEFAULT_VOICE = "Puck";
  private static readonly MAX_RECONNECT_ATTEMPTS = 5;
  private static readonly BASE_RECONNECT_DELAY_MS = 1000;
  private static readonly CONNECT_TIMEOUT_MS = 15_000;

  private ws: WebSocket | null = null;
  private connected = false;
  private intentionallyClosed = false;
  private reconnectAttempts = 0;
  private pendingAudio: Buffer[] = [];
  private markQueue: string[] = [];
  private responseStartTimestamp: number | null = null;
  private latestMediaTimestamp = 0;
  private userTranscript = "";
  private assistantTranscript = "";
  private toolCallNames = new Map<string, string>();

  constructor(private readonly config: GoogleRealtimeVoiceBridgeConfig) {}

  async connect(): Promise<void> {
    this.intentionallyClosed = false;
    this.reconnectAttempts = 0;
    await this.doConnect();
  }

  sendAudio(muLaw: Buffer): void {
    if (!this.connected || this.ws?.readyState !== WebSocket.OPEN) {
      if (this.pendingAudio.length < 320) {
        this.pendingAudio.push(muLaw);
      }
      return;
    }
    this.sendEvent({
      realtimeInput: {
        audio: {
          data: muLaw8kToPcm16k(muLaw).toString("base64"),
          mimeType: "audio/pcm;rate=16000",
        },
      },
    });
  }

  setMediaTimestamp(ts: number): void {
    this.latestMediaTimestamp = ts;
  }

  sendUserMessage(text: string): void {
    this.sendEvent({
      clientContent: {
        turns: [{ role: "user", parts: [{ text }] }],
        turnComplete: true,
      },
    });
  }

  triggerGreeting(instructions?: string): void {
    if (!this.connected || !this.ws) {
      return;
    }
    const greeting = instructions ?? this.config.instructions ?? "Greet the user briefly.";
    this.sendUserMessage(`[Begin the call now: ${greeting}]`);
  }

  submitToolResult(callId: string, result: unknown): void {
    const response = asObjectRecord(result) ?? { result };
    this.sendEvent({
      toolResponse: {
        functionResponses: [
          {
            id: callId,
            name: this.toolCallNames.get(callId) ?? undefined,
            response,
          },
        ],
      },
    });
    this.toolCallNames.delete(callId);
  }

  acknowledgeMark(): void {
    if (this.markQueue.length === 0) {
      return;
    }
    this.markQueue.shift();
    if (this.markQueue.length === 0) {
      this.responseStartTimestamp = null;
    }
  }

  close(): void {
    this.intentionallyClosed = true;
    this.connected = false;
    if (this.ws) {
      this.ws.close(1000, "Bridge closed");
      this.ws = null;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  private async doConnect(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const url = `${LIVE_WS_URL}?key=${encodeURIComponent(this.config.apiKey)}`;
      this.ws = new WebSocket(url);
      let settled = false;

      const connectTimeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error("Gemini Live connection timeout"));
        }
      }, GoogleRealtimeVoiceBridge.CONNECT_TIMEOUT_MS);

      this.ws.on("open", () => {
        this.sendSetup();
      });

      this.ws.on("message", (data: Buffer) => {
        let message: LiveServerMessage;
        try {
          message = JSON.parse(data.toString()) as LiveServerMessage;
        } catch (error) {
          console.error("[google] live event parse failed:", error);
          return;
        }
        if (message.setupComplete && !this.connected) {
          clearTimeout(connectTimeout);
          this.connected = true;
          this.reconnectAttempts = 0;
          for (const chunk of this.pendingAudio.splice(0)) {
            this.sendAudio(chunk);
          }
          this.config.onReady?.();
          if (!settled) {
            settled = true;
            resolve();
          }
          return;
        }
        this.handleEvent(message);
      });

      this.ws.on("error", (error) => {
        if (!settled && !this.connected) {
          settled = true;
          clearTimeout(connectTimeout);
          reject(error);
        }
        this.config.onError?.(error instanceof Error ? error : new Error(String(error)));
      });

      this.ws.on("close", () => {
        this.connected = false;
        if (this.intentionallyClosed) {
          this.config.onClose?.("completed");
          return;
        }
        void this.attemptReconnect();
      });
    });
  }

  private async attemptReconnect(): Promise<void> {
    if (this.intentionallyClosed) {
      return;
    }
    if (this.reconnectAttempts >= GoogleRealtimeVoiceBridge.MAX_RECONNECT_ATTEMPTS) {
      this.config.onClose?.("error");
      return;
    }
    this.reconnectAttempts += 1;
    const delay =
      GoogleRealtimeVoiceBridge.BASE_RECONNECT_DELAY_MS * 2 ** (this.reconnectAttempts - 1);
    await new Promise((resolve) => setTimeout(resolve, delay));
    if (this.intentionallyClosed) {
      return;
    }
    try {
      await this.doConnect();
    } catch (error) {
      this.config.onError?.(error instanceof Error ? error : new Error(String(error)));
      await this.attemptReconnect();
    }
  }

  private sendSetup(): void {
    const cfg = this.config;
    this.sendEvent({
      setup: {
        model: toModelPath(cfg.model ?? GoogleRealtimeVoiceBridge.DEFAULT_MODEL),
        generationConfig: {
          responseModalities: ["AUDIO"],
          ...(cfg.temperature !== undefined ? { temperature: cfg.temperature } : {}),
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: cfg.voice ?? GoogleRealtimeVoiceBridge.DEFAULT_VOICE,
              },
            },
          },
        },
        ...(cfg.instructions
          ? { systemInstruction: { parts: [{ text: cfg.instructions }] } }
          : {}),
        ...(toFunctionDeclarations(cfg.tools) ? { tools: toFunctionDeclarations(cfg.tools) } : {}),
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
    });
  }

  private handleEvent(message: LiveServerMessage): void {
    const content = message.serverContent;
    if (content) {
      if (content.interrupted) {
        this.handleBargeIn();
        return;
      }
      for (const part of content.modelTurn?.parts ?? []) {
        const data = part.inlineData?.data;
        if (!data) {
          continue;
        }
        this.config.onAudio(pcm24kToMuLaw8k(Buffer.from(data, "base64")));
        if (this.responseStartTimestamp === null) {
          this.responseStartTimestamp = this.latestMediaTimestamp;
        }
        this.sendMark();
      }
      if (content.inputTranscription?.text) {
        this.userTranscript += content.inputTranscription.text;
        this.config.onTranscript?.("user", content.inputTranscription.text, false);
      }
      if (content.outputTranscription?.text) {
        this.assistantTranscript += content.outputTranscription.text;
        this.config.onTranscript?.("assistant", content.outputTranscription.text, false);
      }
      if (content.turnComplete) {
        if (this.userTranscript.trim()) {
          this.config.onTranscript?.("user", this.userTranscript.trim(), true);
        }
        if (this.assistantTranscript.trim()) {
          this.config.onTranscript?.("assistant", this.assistantTranscript.trim(), true);
        }
        this.userTranscript = "";
        this.assistantTranscript = "";
      }
      return;
    }

    if (message.toolCall?.functionCalls) {
      for (const call of message.toolCall.functionCalls) {
        const callId = call.id ?? `call-${Date.now()}`;
        this.toolCallNames.set(callId, call.name ?? "");
        this.config.onToolCall?.({
          itemId: callId,
          callId,
          name: call.name ?? "",
          args: call.args ?? {},
        });
      }
      return;
    }

    if (message.toolCallCancellation?.ids) {
      for (const id of message.toolCallCancellation.ids) {
        this.toolCallNames.delete(id);
      }
      return;
    }

    if (message.error) {
      const detail = asObjectRecord(message.error)?.message;
      this.config.onError?.(
        new Error(typeof detail === "string" && detail ? detail : "Gemini Live error"),
      );
    }
  }

  private handleBargeIn(): void {
    this.config.onClearAudio();
    this.markQueue = [];
    this.responseStartTimestamp = null;
    this.assistantTranscript = "";
  }

  private sendMark(): void {
    const markName = `audio-${Date.now()}`;
    this.markQueue.push(markName);
    this.config.onMark?.(markName);
  }

  private sendEvent(event: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(event));
    }
  }
}

export function buildGoogleRealtimeVoiceProvider(): RealtimeVoiceProviderPlugin {
  return {
    id: "google",
    label: "Gemini Live",
    autoSelectOrder: 20,
    resolveConfig: ({ rawConfig }) => normalizeProviderConfig(rawConfig),
    isConfigured: ({ providerConfig }) =>
      Boolean(normalizeProviderConfig(providerConfig).apiKey || resolveEnvApiKey()),
    createBridge: (req) => {
      const config = normalizeProviderConfig(req.providerConfig);
      const apiKey = config.apiKey || resolveEnvApiKey();
      if (!apiKey) {
        throw new Error("Gemini API key missing");
      }
      return new GoogleRealtimeVoiceBridge({
        ...req,
        apiKey,
        model: config.model,
        voice: config.voice,
        temperature: config.temperature,
      });
    },
  };
}

export type { GoogleRealtimeVoiceProviderConfig };
