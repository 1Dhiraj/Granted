/**
 * Browser-native speech services: STT via SpeechRecognition, TTS via SpeechSynthesis.
 * Falls back gracefully when APIs are unavailable.
 */

// ─── STT (Speech-to-Text) ───

type SpeechRecognitionEvent = Event & {
  results: SpeechRecognitionResultList;
  resultIndex: number;
};

type SpeechRecognitionErrorEvent = Event & {
  error: string;
  message?: string;
};

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = globalThis as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as SpeechRecognitionCtor | null;
}

export function isSttSupported(): boolean {
  return getSpeechRecognitionCtor() !== null;
}

export type SttCallbacks = {
  onTranscript: (text: string, isFinal: boolean) => void;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (error: string) => void;
};

let activeRecognition: SpeechRecognitionInstance | null = null;

export function startStt(callbacks: SttCallbacks): boolean {
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) {
    callbacks.onError?.("Speech recognition is not supported in this browser");
    return false;
  }

  stopStt();

  const recognition = new Ctor();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = navigator.language || "en-US";

  recognition.addEventListener("start", () => callbacks.onStart?.());

  recognition.addEventListener("result", (event) => {
    const speechEvent = event as unknown as SpeechRecognitionEvent;
    let interimTranscript = "";
    let finalTranscript = "";

    for (let i = speechEvent.resultIndex; i < speechEvent.results.length; i++) {
      const result = speechEvent.results[i];
      if (!result?.[0]) {
        continue;
      }
      const transcript = result[0].transcript;
      if (result.isFinal) {
        finalTranscript += transcript;
      } else {
        interimTranscript += transcript;
      }
    }

    if (finalTranscript) {
      callbacks.onTranscript(finalTranscript, true);
    } else if (interimTranscript) {
      callbacks.onTranscript(interimTranscript, false);
    }
  });

  recognition.addEventListener("error", (event) => {
    const speechEvent = event as unknown as SpeechRecognitionErrorEvent;
    if (speechEvent.error === "aborted" || speechEvent.error === "no-speech") {
      return;
    }
    callbacks.onError?.(speechEvent.error);
  });

  recognition.addEventListener("end", () => {
    if (activeRecognition === recognition) {
      activeRecognition = null;
    }
    callbacks.onEnd?.();
  });

  activeRecognition = recognition;
  recognition.start();
  return true;
}

export function stopStt(): void {
  if (activeRecognition) {
    const r = activeRecognition;
    activeRecognition = null;
    try {
      r.stop();
    } catch {
      // already stopped
    }
  }
}

export function isSttActive(): boolean {
  return activeRecognition !== null;
}

// ─── TTS (Text-to-Speech) ───
// Two engines behind one API: the gateway's server voice (natural neural voice
// with SSML expressiveness) is preferred when connected; the browser's
// speechSynthesis is the always-available fallback. `queue: true` plays chunks
// back-to-back in order (used by talk mode) instead of interrupting.

export function isTtsSupported(): boolean {
  return "speechSynthesis" in globalThis;
}

type SpeakOpts = {
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (error: string) => void;
  /** Append to the playback queue instead of interrupting current speech. */
  queue?: boolean;
  /** Preferred server TTS provider (e.g. "piper" for low-latency talk mode). */
  provider?: string;
};

type GatewayRequestFn = (
  method: string,
  params: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

let serverTtsProvider: (() => GatewayRequestFn | null) | null = null;

/** Wire the gateway client so speech uses the server's natural voice. */
export function setServerTtsProvider(provider: () => GatewayRequestFn | null): void {
  serverTtsProvider = provider;
}

let currentUtterance: SpeechSynthesisUtterance | null = null;
let currentAudio: HTMLAudioElement | null = null;
let serverQueue: Promise<void> = Promise.resolve();
let serverPending = 0;
// Bumped by stopTts(); queued jobs from an older generation are dropped.
let speakGeneration = 0;

function speakBrowser(text: string, opts?: SpeakOpts): boolean {
  if (!isTtsSupported()) {
    opts?.onError?.("Speech synthesis is not supported in this browser");
    return false;
  }
  const cleaned = stripMarkdown(text);
  if (!cleaned.trim()) {
    return false;
  }
  const utterance = new SpeechSynthesisUtterance(cleaned);
  utterance.rate = 1.0;
  utterance.pitch = 1.0;
  let settled = false;
  utterance.addEventListener("start", () => opts?.onStart?.());
  utterance.addEventListener("end", () => {
    if (currentUtterance === utterance) {
      currentUtterance = null;
    }
    if (!settled) {
      settled = true;
      opts?.onEnd?.();
    }
  });
  utterance.addEventListener("error", (e) => {
    if (currentUtterance === utterance) {
      currentUtterance = null;
    }
    if (settled) {
      return;
    }
    settled = true;
    if (e.error === "canceled" || e.error === "interrupted") {
      opts?.onEnd?.();
      return;
    }
    opts?.onError?.(e.error);
  });
  currentUtterance = utterance;
  speechSynthesis.speak(utterance);
  return true;
}

async function playServerAudio(
  request: GatewayRequestFn,
  text: string,
  generation: number,
  opts?: SpeakOpts,
): Promise<void> {
  // Quality-first chain: Ava (best free voice) primary, Piper (instant local)
  // as fallback the moment Ava fails/times out. A specific opts.provider forces
  // just that one. Send the ORIGINAL text — the server humanizer turns *markers*
  // into real vocal emphasis; stripping markdown here would flatten the prosody.
  const providerChain = opts?.provider ? [opts.provider] : ["microsoft", "piper"];
  let audioBase64 = "";
  let mime = "audio/mpeg";
  let lastError: unknown;
  for (const provider of providerChain) {
    if (generation !== speakGeneration) {
      return; // canceled while synthesizing
    }
    try {
      const res = await request("tts.convert", { text, returnAudio: true, provider });
      const b64 = typeof res?.audioBase64 === "string" ? res.audioBase64 : "";
      if (b64) {
        audioBase64 = b64;
        mime = typeof res?.audioMime === "string" ? res.audioMime : "audio/mpeg";
        break;
      }
    } catch (err) {
      lastError = err;
    }
  }
  if (!audioBase64) {
    throw lastError instanceof Error ? lastError : new Error("no audio from any provider");
  }
  if (generation !== speakGeneration) {
    return; // canceled while synthesizing
  }
  const bytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  await new Promise<void>((resolve, reject) => {
    const audio = new Audio(url);
    currentAudio = audio;
    const cleanup = () => {
      if (currentAudio === audio) {
        currentAudio = null;
      }
      URL.revokeObjectURL(url);
    };
    audio.onplay = () => opts?.onStart?.();
    audio.onended = () => {
      cleanup();
      resolve();
    };
    audio.onerror = () => {
      cleanup();
      reject(new Error("audio playback failed"));
    };
    audio.play().catch((err) => {
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
}

export function speakText(text: string, opts?: SpeakOpts): boolean {
  if (!opts?.queue) {
    stopTts();
  }
  if (!stripMarkdown(text).trim()) {
    return false;
  }
  const request = serverTtsProvider?.() ?? null;
  if (request) {
    const generation = speakGeneration;
    serverPending += 1;
    serverQueue = serverQueue
      .then(async () => {
        if (generation !== speakGeneration) {
          return;
        }
        try {
          await playServerAudio(request, text, generation, opts);
        } catch {
          // Server voice unavailable — fall back so speech never breaks.
          if (generation === speakGeneration) {
            const ok = speakBrowser(text, { ...opts, queue: true });
            if (ok) {
              return;
            }
          }
          opts?.onEnd?.();
        }
      })
      .finally(() => {
        serverPending = Math.max(0, serverPending - 1);
      });
    return true;
  }
  return speakBrowser(text, opts);
}

export function stopTts(): void {
  speakGeneration += 1;
  serverQueue = Promise.resolve();
  if (currentAudio) {
    const audio = currentAudio;
    currentAudio = null;
    try {
      audio.pause();
    } catch {
      // already stopped
    }
  }
  if (currentUtterance) {
    currentUtterance = null;
  }
  if (isTtsSupported()) {
    speechSynthesis.cancel();
  }
}

export function isTtsSpeaking(): boolean {
  return (
    currentAudio !== null ||
    serverPending > 0 ||
    (isTtsSupported() && speechSynthesis.speaking)
  );
}

/** Strip common markdown syntax for cleaner speech output. */
export function stripMarkdown(text: string): string {
  return (
    text
      // code blocks
      .replace(/```[\s\S]*?```/g, "")
      // inline code
      .replace(/`[^`]+`/g, "")
      // images
      .replace(/!\[.*?\]\(.*?\)/g, "")
      // links → keep text
      .replace(/\[([^\]]+)\]\(.*?\)/g, "$1")
      // headings
      .replace(/^#{1,6}\s+/gm, "")
      // bold/italic
      .replace(/\*{1,3}(.*?)\*{1,3}/g, "$1")
      .replace(/_{1,3}(.*?)_{1,3}/g, "$1")
      // blockquotes
      .replace(/^>\s?/gm, "")
      // horizontal rules
      .replace(/^[-*_]{3,}\s*$/gm, "")
      // list markers
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/^\s*\d+\.\s+/gm, "")
      // HTML tags
      .replace(/<[^>]+>/g, "")
      // collapse whitespace
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}
