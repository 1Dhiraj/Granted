import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { isVoiceCompatibleAudio } from "openclaw/plugin-sdk/media-runtime";
import type {
  SpeechProviderConfig,
  SpeechProviderPlugin,
  SpeechVoiceOption,
} from "openclaw/plugin-sdk/speech";
import { asFiniteNumber, asObject, trimToUndefined } from "openclaw/plugin-sdk/speech";
import { resolvePreferredOpenClawTmpDir } from "openclaw/plugin-sdk/temp-path";

// Piper: fully-local, open-source neural TTS. Runs a small ONNX voice model on
// the CPU (~real-time, no GPU, no network, no key) — so it is permanently free
// and low-latency. Each user's machine synthesizes its own audio.

function defaultPiperDir(): string {
  const home = process.env.OPENCLAW_HOME?.trim() || path.join(os.homedir(), ".openclaw");
  return path.join(home, "piper", "piper");
}

type PiperProviderConfig = {
  binPath: string;
  modelPath: string;
  espeakDataDir?: string;
  /** Speed: <1 faster, >1 slower. Default 1. */
  lengthScale: number;
  /** Multi-speaker model speaker id (default 0). */
  speaker?: number;
};

function normalizePiperConfig(rawConfig: Record<string, unknown>): PiperProviderConfig {
  const providers = asObject(rawConfig.providers);
  // Merge: top-level (already-normalized config) + nested provider config
  // (raw messages.tts shape). Works whether we get the raw or resolved object.
  const raw = { ...rawConfig, ...asObject(rawConfig.piper), ...asObject(providers?.piper) };
  const dir = defaultPiperDir();
  const binPath = trimToUndefined(raw.binPath) ?? path.join(dir, "piper.exe");
  const voice = trimToUndefined(raw.voice) ?? "en_US-amy-medium";
  const modelPath =
    trimToUndefined(raw.modelPath) ??
    (voice.endsWith(".onnx") ? voice : path.join(dir, `${voice}.onnx`));
  const espeakDataDir = trimToUndefined(raw.espeakDataDir) ?? path.join(dir, "espeak-ng-data");
  return {
    binPath,
    modelPath,
    espeakDataDir: existsSync(espeakDataDir) ? espeakDataDir : undefined,
    lengthScale: asFiniteNumber(raw.lengthScale) ?? 1,
    speaker: asFiniteNumber(raw.speaker) ?? undefined,
  };
}

function readPiperConfig(config: SpeechProviderConfig): PiperProviderConfig {
  return normalizePiperConfig(config as Record<string, unknown>);
}

// Piper reads plain text and cannot interpret SSML/markdown — strip anything it
// would otherwise pronounce literally (asterisks, backticks, links), keep the
// punctuation it DOES use for prosody (commas, periods, ?, !, ...).
function cleanForPiper(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " code omitted ")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/[\r\n]+/g, ". ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function runPiper(params: {
  binPath: string;
  modelPath: string;
  espeakDataDir?: string;
  outputPath: string;
  text: string;
  lengthScale: number;
  speaker?: number;
  timeoutMs: number;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ["-m", params.modelPath, "-f", params.outputPath];
    if (params.espeakDataDir) {
      args.push("--espeak_data", params.espeakDataDir);
    }
    if (params.lengthScale !== 1) {
      args.push("--length_scale", String(params.lengthScale));
    }
    if (typeof params.speaker === "number") {
      args.push("--speaker", String(params.speaker));
    }
    // cwd = binary dir so piper resolves its DLLs + espeak-ng-data reliably.
    const child = spawn(params.binPath, args, {
      cwd: path.dirname(params.binPath),
      windowsHide: true,
    });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("piper timed out"));
    }, params.timeoutMs);
    child.stderr?.on("data", (d) => {
      stderr += String(d);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && existsSync(params.outputPath)) {
        resolve();
      } else {
        reject(new Error(`piper exited ${code}: ${stderr.slice(-300)}`));
      }
    });
    child.stdin?.write(params.text);
    child.stdin?.end();
  });
}

export function buildPiperSpeechProvider(): SpeechProviderPlugin {
  return {
    id: "piper",
    label: "Piper (local)",
    autoSelectOrder: 25,
    resolveConfig: ({ rawConfig }) => normalizePiperConfig(rawConfig) as SpeechProviderConfig,
    resolveTalkConfig: ({ baseTtsConfig }) =>
      normalizePiperConfig(baseTtsConfig) as SpeechProviderConfig,
    resolveTalkOverrides: ({ params }) =>
      trimToUndefined(params.voiceId) == null
        ? undefined
        : ({ voice: trimToUndefined(params.voiceId) } as SpeechProviderConfig),
    isConfigured: ({ providerConfig }) => {
      const c = readPiperConfig(providerConfig);
      return existsSync(c.binPath) && existsSync(c.modelPath);
    },
    listVoices: async (): Promise<SpeechVoiceOption[]> => {
      const c = readPiperConfig({} as SpeechProviderConfig);
      const name = path.basename(c.modelPath, ".onnx");
      return [{ id: name, name, locale: "en-US" }];
    },
    synthesize: async (req) => {
      const config = readPiperConfig(req.providerConfig);
      const overrideVoice = trimToUndefined(req.providerOverrides?.voice);
      const modelPath = overrideVoice
        ? overrideVoice.endsWith(".onnx")
          ? overrideVoice
          : path.join(path.dirname(config.binPath), `${overrideVoice}.onnx`)
        : config.modelPath;
      if (!existsSync(config.binPath)) {
        throw new Error(`piper binary not found at ${config.binPath}`);
      }
      if (!existsSync(modelPath)) {
        throw new Error(`piper voice model not found at ${modelPath}`);
      }
      const tempRoot = resolvePreferredOpenClawTmpDir();
      mkdirSync(tempRoot, { recursive: true, mode: 0o700 });
      const tempDir = mkdtempSync(path.join(tempRoot, "tts-piper-"));
      const outputPath = path.join(tempDir, "speech.wav");
      try {
        await runPiper({
          binPath: config.binPath,
          modelPath,
          espeakDataDir: config.espeakDataDir,
          outputPath,
          text: cleanForPiper(req.text) || "…",
          lengthScale: config.lengthScale,
          speaker: config.speaker,
          timeoutMs: req.timeoutMs,
        });
        const audioBuffer = readFileSync(outputPath);
        return {
          audioBuffer,
          outputFormat: "riff-22050hz-16bit-mono-pcm",
          fileExtension: ".wav",
          voiceCompatible: isVoiceCompatibleAudio({ fileName: outputPath }),
        };
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    },
  };
}
