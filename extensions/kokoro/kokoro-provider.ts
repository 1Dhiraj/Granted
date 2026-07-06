import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { isVoiceCompatibleAudio } from "openclaw/plugin-sdk/media-runtime";
import type {
  SpeechProviderConfig,
  SpeechProviderPlugin,
  SpeechVoiceOption,
} from "openclaw/plugin-sdk/speech";
import { asFiniteNumber, asObject, trimToUndefined } from "openclaw/plugin-sdk/speech";

// Kokoro: high-quality neural voice (82M). It is heavier than Piper, so it runs
// in a SEPARATE persistent worker process (loads the model once, stays resident)
// reached over local HTTP — its inference load is fully isolated from the gateway,
// and this extension itself carries no heavy dependencies.

const KOKORO_VOICES = [
  "af_heart",
  "af_bella",
  "af_nicole",
  "af_sarah",
  "am_michael",
  "am_adam",
  "am_puck",
  "bf_emma",
  "bm_george",
];

function kokoroDir(): string {
  const home = process.env.OPENCLAW_HOME?.trim() || path.join(os.homedir(), ".openclaw");
  return path.join(home, "kokoro");
}

type KokoroConfig = {
  workerDir: string;
  port: number;
  dtype: string;
  voice: string;
};

function normalizeKokoroConfig(rawConfig: Record<string, unknown>): KokoroConfig {
  const providers = asObject(rawConfig.providers);
  const raw = { ...rawConfig, ...asObject(rawConfig.kokoro), ...asObject(providers?.kokoro) };
  return {
    workerDir: trimToUndefined(raw.workerDir) ?? kokoroDir(),
    port: asFiniteNumber(raw.port) ?? 18795,
    dtype: trimToUndefined(raw.dtype) ?? "q8",
    voice: trimToUndefined(raw.voice) ?? "af_heart",
  };
}

async function workerHealthy(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

let starting: Promise<void> | null = null;

async function ensureWorker(config: KokoroConfig, timeoutMs: number): Promise<void> {
  if (await workerHealthy(config.port)) {
    return;
  }
  if (!starting) {
    starting = (async () => {
      const child = spawn(process.execPath, ["kokoro-server.mjs"], {
        cwd: config.workerDir,
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        env: {
          ...process.env,
          KOKORO_PORT: String(config.port),
          KOKORO_DTYPE: config.dtype,
        },
      });
      child.unref();
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1000));
        if (await workerHealthy(config.port)) {
          return;
        }
      }
      throw new Error("kokoro worker did not become ready (model load timed out)");
    })();
  }
  try {
    await starting;
  } finally {
    starting = null;
  }
}

export function buildKokoroSpeechProvider(): SpeechProviderPlugin {
  return {
    id: "kokoro",
    label: "Kokoro (local, high quality)",
    autoSelectOrder: 35,
    resolveConfig: ({ rawConfig }) => normalizeKokoroConfig(rawConfig) as SpeechProviderConfig,
    resolveTalkConfig: ({ baseTtsConfig }) =>
      normalizeKokoroConfig(baseTtsConfig) as SpeechProviderConfig,
    resolveTalkOverrides: ({ params }) =>
      trimToUndefined(params.voiceId) == null
        ? undefined
        : ({ voice: trimToUndefined(params.voiceId) } as SpeechProviderConfig),
    isConfigured: ({ providerConfig }) => {
      const c = normalizeKokoroConfig(providerConfig as Record<string, unknown>);
      return (
        existsSync(path.join(c.workerDir, "kokoro-server.mjs")) &&
        existsSync(path.join(c.workerDir, "node_modules", "kokoro-js"))
      );
    },
    listVoices: async (): Promise<SpeechVoiceOption[]> =>
      KOKORO_VOICES.map((id) => ({
        id,
        name: id,
        gender: id.startsWith("a") ? undefined : id[0] === "m" ? "male" : undefined,
        locale: id.startsWith("b") ? "en-GB" : "en-US",
      })),
    synthesize: async (req) => {
      const config = normalizeKokoroConfig(req.providerConfig as Record<string, unknown>);
      const voice = trimToUndefined(req.providerOverrides?.voice) ?? config.voice;
      // Generous readiness budget: first-ever call may download/load the model.
      await ensureWorker(config, Math.max(req.timeoutMs, 90_000));
      const res = await fetch(`http://127.0.0.1:${config.port}/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: req.text, voice }),
        signal: AbortSignal.timeout(Math.max(req.timeoutMs, 60_000)),
      });
      if (!res.ok) {
        throw new Error(`kokoro worker error ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
      const audioBuffer = Buffer.from(await res.arrayBuffer());
      if (audioBuffer.length === 0) {
        throw new Error("kokoro produced empty audio");
      }
      return {
        audioBuffer,
        outputFormat: "riff-24000hz-16bit-mono-pcm",
        fileExtension: ".wav",
        voiceCompatible: isVoiceCompatibleAudio({ fileName: "speech.wav" }),
      };
    },
  };
}
