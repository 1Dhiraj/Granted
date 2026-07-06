import { createWriteStream, statSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { EdgeTTS } from "node-edge-tts";
import {
  CHROMIUM_FULL_VERSION,
  TRUSTED_CLIENT_TOKEN,
  generateSecMsGecToken,
} from "node-edge-tts/dist/drm.js";
import { normalizeLowercaseStringOrEmpty } from "openclaw/plugin-sdk/text-runtime";
import { WebSocket } from "ws";

export function inferEdgeExtension(outputFormat: string): string {
  const normalized = normalizeLowercaseStringOrEmpty(outputFormat);
  if (normalized.includes("webm")) {
    return ".webm";
  }
  if (normalized.includes("ogg")) {
    return ".ogg";
  }
  if (normalized.includes("opus")) {
    return ".opus";
  }
  if (normalized.includes("wav") || normalized.includes("riff") || normalized.includes("pcm")) {
    return ".wav";
  }
  return ".mp3";
}

export async function edgeTTS(params: {
  text: string;
  outputPath: string;
  config: {
    voice: string;
    lang: string;
    outputFormat: string;
    saveSubtitles: boolean;
    proxy?: string;
    rate?: string;
    pitch?: string;
    volume?: string;
    timeoutMs?: number;
  };
  timeoutMs: number;
}): Promise<void> {
  const { text, outputPath, config, timeoutMs } = params;
  const tts = new EdgeTTS({
    voice: config.voice,
    lang: config.lang,
    outputFormat: config.outputFormat,
    saveSubtitles: config.saveSubtitles,
    proxy: config.proxy,
    rate: config.rate,
    pitch: config.pitch,
    volume: config.volume,
    timeout: config.timeoutMs ?? timeoutMs,
  });
  await tts.ttsPromise(text, outputPath);

  const { size } = statSync(outputPath);
  if (size === 0) {
    throw new Error("Edge TTS produced empty audio file");
  }
}

// ── Expressive (human-like) synthesis ──────────────────────────────────
// The Edge service accepts full SSML (emphasis, breaks, mstts:express-as
// speaking styles) on the same free endpoint, but node-edge-tts hardcodes a
// plain wrapper and XML-escapes the text, so none of it is reachable. This is
// our own sender over the same protocol with caller-controlled SSML.

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&"']/g, (c) => {
    switch (c) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case '"':
        return "&quot;";
      case "'":
        return "&apos;";
      default:
        return c;
    }
  });
}

/**
 * Convert assistant text into expressive SSML content:
 * - markdown cleanup (code blocks summarized, links -> label, bullets/headers spoken plainly)
 * - *word* / **word** -> spoken emphasis (stress)
 * - "..." and em-dashes -> natural pauses; paragraph gaps -> longer pauses
 * Escapes user text FIRST, then inserts tags, so injection is impossible.
 */
export function humanizeToSsml(text: string): string {
  let t = text;
  // Markdown the voice should not read literally.
  t = t.replace(/```[\s\S]*?```/g, " (code omitted) ");
  t = t.replace(/`([^`\n]+)`/g, "$1");
  t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  t = t.replace(/^#{1,6}\s+/gm, "");
  t = t.replace(/^\s*[-*+]\s+/gm, "");
  t = t.replace(/^\s*\d+\.\s+/gm, "");
  // Escape everything, THEN convert surviving plain markers into SSML tags.
  t = escapeXml(t);
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '<emphasis level="strong">$1</emphasis>');
  t = t.replace(/\*([^*\n]+)\*/g, '<emphasis level="moderate">$1</emphasis>');
  t = t.replace(/(\.\.\.|…)/g, '<break time="350ms"/>');
  t = t.replace(/\s—\s|\s-\s—?/g, '<break time="250ms"/> ');
  t = t.replace(/\n{2,}/g, '<break time="500ms"/> ');
  t = t.replace(/\n/g, " ");
  return t.trim();
}

export function buildExpressiveSsml(params: {
  innerSsml: string;
  voice: string;
  lang: string;
  rate?: string;
  pitch?: string;
  volume?: string;
  /** Speaking style (needs a style-capable voice like en-US-AriaNeural / en-US-JennyNeural). */
  style?: string;
  /** Style intensity 0.01–2 (default 1). */
  styleDegree?: string;
}): string {
  let body = params.innerSsml;
  const prosodyAttrs = [
    params.rate ? ` rate="${escapeXml(params.rate)}"` : "",
    params.pitch ? ` pitch="${escapeXml(params.pitch)}"` : "",
    params.volume ? ` volume="${escapeXml(params.volume)}"` : "",
  ].join("");
  if (prosodyAttrs) {
    body = `<prosody${prosodyAttrs}>${body}</prosody>`;
  }
  if (params.style) {
    const degree = params.styleDegree ? ` styledegree="${escapeXml(params.styleDegree)}"` : "";
    body = `<mstts:express-as style="${escapeXml(params.style)}"${degree}>${body}</mstts:express-as>`;
  }
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" ` +
    `xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${escapeXml(params.lang)}">` +
    `<voice name="${escapeXml(params.voice)}">${body}</voice></speak>`
  );
}

/** Send prepared SSML over the free Edge readaloud websocket; write audio to outputPath. */
export async function edgeTTSSSML(params: {
  ssml: string;
  outputPath: string;
  outputFormat: string;
  timeoutMs: number;
}): Promise<void> {
  const major = CHROMIUM_FULL_VERSION.split(".")[0] || "0";
  const ws = new WebSocket(
    `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1` +
      `?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
      `&Sec-MS-GEC=${generateSecMsGecToken()}` +
      `&Sec-MS-GEC-Version=1-${CHROMIUM_FULL_VERSION}`,
    {
      host: "speech.platform.bing.com",
      origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
      headers: {
        Pragma: "no-cache",
        "Cache-Control": "no-cache",
        "User-Agent":
          `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ` +
          `(KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36 Edg/${major}.0.0.0`,
        "Accept-Encoding": "gzip, deflate, br, zstd",
        "Accept-Language": "en-US,en;q=0.9",
      },
    },
  );
  await new Promise<void>((resolve, reject) => {
    ws.on("open", () => {
      ws.send(
        `Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
          JSON.stringify({
            context: {
              synthesis: {
                audio: {
                  metadataoptions: {
                    sentenceBoundaryEnabled: "false",
                    wordBoundaryEnabled: "false",
                  },
                  outputFormat: params.outputFormat,
                },
              },
            },
          }),
      );
      resolve();
    });
    ws.on("error", reject);
  });
  await new Promise<void>((resolve, reject) => {
    const audioStream = createWriteStream(params.outputPath);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("Edge TTS (expressive) timed out"));
    }, params.timeoutMs);
    ws.on("message", (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        const separator = "Path:audio\r\n";
        const index = data.indexOf(separator) + separator.length;
        audioStream.write(data.subarray(index));
        return;
      }
      if (data.toString().includes("Path:turn.end")) {
        audioStream.end();
        audioStream.on("finish", () => {
          ws.close();
          clearTimeout(timeout);
          resolve();
        });
      }
    });
    ws.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    const requestId = randomBytes(16).toString("hex");
    ws.send(
      `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n` +
        params.ssml,
    );
  });

  const { size } = statSync(params.outputPath);
  if (size === 0) {
    throw new Error("Edge TTS (expressive) produced empty audio file");
  }
}
