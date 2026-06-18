/**
 * Talk mode: hands-free voice conversation with the agent.
 *
 * Loop: listen (browser STT) → silence → send transcript → speak the reply
 * sentence-by-sentence WHILE it streams (low perceived latency) → listen again.
 *
 * The mic is paused while the assistant speaks: browser STT has no echo
 * cancellation against speaker output, so leaving it on would transcribe the
 * assistant's own voice back into the conversation. Clicking the talk button
 * while speaking interrupts speech and returns to listening.
 */

import { extractText } from "./message-extract.ts";
import { isSttSupported, isTtsSupported, startStt, stopStt, stripMarkdown } from "./speech.ts";

export type TalkPhase = "off" | "listening" | "thinking" | "speaking";

type TalkHooks = {
  send: (text: string) => void;
  requestUpdate: () => void;
};

/** Silence after the last finalized phrase before the transcript is sent. */
const SEND_SILENCE_MS = 900;
/** Minimum chars before a mid-stream chunk is worth speaking on its own. */
const MIN_SPOKEN_CHUNK = 12;
/** Delay before the mic re-arms after speech ends (lets the audio tail fade). */
const RELISTEN_DELAY_MS = 350;

let phase: TalkPhase = "off";
let hooks: TalkHooks | null = null;
let pendingText = "";
let interimText = "";
let sendTimer: ReturnType<typeof setTimeout> | null = null;
let relistenTimer: ReturnType<typeof setTimeout> | null = null;
let sttRestartTimer: ReturnType<typeof setTimeout> | null = null;
/** Index into the raw streamed text up to which sentences were already queued. */
let spokenIdx = 0;
let lastStreamText = "";
let runActive = false;
let finalSeen = false;
let utterancesPending = 0;
let restartTimestamps: number[] = [];

export function getTalkPhase(): TalkPhase {
  return phase;
}

export function isTalkActive(): boolean {
  return phase !== "off";
}

export function getTalkInterim(): string {
  return phase === "listening" ? interimText : "";
}

export function isTalkSupported(): boolean {
  return isSttSupported() && isTtsSupported();
}

function setPhase(next: TalkPhase) {
  if (phase === next) {
    return;
  }
  phase = next;
  hooks?.requestUpdate();
}

function clearTimers() {
  for (const t of [sendTimer, relistenTimer, sttRestartTimer]) {
    if (t) {
      clearTimeout(t);
    }
  }
  sendTimer = null;
  relistenTimer = null;
  sttRestartTimer = null;
}

export function startTalk(next: TalkHooks): boolean {
  if (!isTalkSupported()) {
    return false;
  }
  stopTalk();
  hooks = next;
  resetStreamState();
  restartTimestamps = [];
  pendingText = "";
  interimText = "";
  setPhase("listening");
  return beginListening();
}

export function stopTalk() {
  clearTimers();
  if (phase === "off") {
    return;
  }
  stopStt();
  cancelSpeech();
  pendingText = "";
  interimText = "";
  resetStreamState();
  setPhase("off");
  hooks = null;
}

/** Stop the current speech output and go straight back to listening. */
export function interruptTalk() {
  if (phase !== "speaking") {
    return;
  }
  cancelSpeech();
  resetStreamState();
  resumeListening();
}

function resetStreamState() {
  spokenIdx = 0;
  lastStreamText = "";
  runActive = false;
  finalSeen = false;
  utterancesPending = 0;
}

function cancelSpeech() {
  utterancesPending = 0;
  if (isTtsSupported()) {
    speechSynthesis.cancel();
  }
}

function beginListening(): boolean {
  const ok = startStt({
    onTranscript: (text, isFinal) => {
      if (phase !== "listening") {
        return;
      }
      if (isFinal) {
        const sep = pendingText && !pendingText.endsWith(" ") ? " " : "";
        pendingText += sep + text.trim();
        interimText = "";
        scheduleSend();
      } else {
        interimText = text;
        // The user is still talking — hold off sending.
        if (sendTimer) {
          clearTimeout(sendTimer);
          sendTimer = null;
        }
      }
      hooks?.requestUpdate();
    },
    onEnd: () => {
      // Browser STT self-terminates after silence; re-arm while we own the mic.
      // A burst of immediate deaths means the mic is unusable — bail instead of spinning.
      const now = Date.now();
      restartTimestamps = restartTimestamps.filter((t) => now - t < 3000);
      restartTimestamps.push(now);
      if (restartTimestamps.length > 5) {
        stopTalk();
        return;
      }
      if (phase === "listening" && hooks) {
        sttRestartTimer = setTimeout(() => {
          if (phase === "listening" && hooks) {
            beginListening();
          }
        }, 250);
      }
    },
    onError: (error) => {
      if (error === "not-allowed" || error === "service-not-allowed") {
        stopTalk();
      }
    },
  });
  if (!ok) {
    stopTalk();
  }
  return ok;
}

function scheduleSend() {
  if (sendTimer) {
    clearTimeout(sendTimer);
  }
  sendTimer = setTimeout(() => {
    sendTimer = null;
    const text = pendingText.trim();
    if (!text || phase !== "listening" || !hooks) {
      return;
    }
    pendingText = "";
    interimText = "";
    resetStreamState();
    runActive = true;
    setPhase("thinking");
    hooks.send(text);
  }, SEND_SILENCE_MS);
}

function resumeListening() {
  if (!hooks || phase === "off") {
    return;
  }
  resetStreamState();
  setPhase("listening");
  relistenTimer = setTimeout(() => {
    if (phase === "listening" && hooks) {
      beginListening();
    }
  }, RELISTEN_DELAY_MS);
}

/**
 * Queue one chunk for speech. Chunks ride the native speechSynthesis queue, so
 * sentences play back-to-back in order while later ones are still streaming in.
 */
function speakChunk(rawChunk: string) {
  const cleaned = stripMarkdown(rawChunk).trim();
  if (!cleaned) {
    maybeFinishSpeaking();
    return;
  }
  if (phase === "thinking") {
    // First audible sentence: stop the mic so it does not hear the assistant.
    stopStt();
    setPhase("speaking");
  }
  utterancesPending += 1;
  const utterance = new SpeechSynthesisUtterance(cleaned);
  utterance.rate = 1.0;
  const settle = () => {
    utterancesPending = Math.max(0, utterancesPending - 1);
    maybeFinishSpeaking();
  };
  utterance.addEventListener("end", settle);
  utterance.addEventListener("error", settle);
  speechSynthesis.speak(utterance);
}

function maybeFinishSpeaking() {
  if (phase !== "speaking" && phase !== "thinking") {
    return;
  }
  if (finalSeen && utterancesPending === 0 && !runActive) {
    resumeListening();
  }
}

/** True when the tail still has an unclosed ``` fence — wait for the close. */
function insideCodeFence(text: string): boolean {
  const fences = text.match(/```/g);
  return Boolean(fences && fences.length % 2 === 1);
}

function flushSentences(streamText: string, isFinal: boolean) {
  lastStreamText = streamText;
  if (spokenIdx > streamText.length) {
    // Stream restarted (new run reusing the buffer) — start over.
    spokenIdx = 0;
  }
  let tail = streamText.slice(spokenIdx);
  if (!isFinal && insideCodeFence(tail)) {
    return;
  }
  if (isFinal) {
    if (tail.trim()) {
      speakChunk(tail);
    }
    spokenIdx = streamText.length;
    return;
  }
  // Speak every complete sentence; keep the unfinished remainder buffered.
  const boundary = /[.!?][)"'’\]]*\s|\n\n/g;
  let consumed = 0;
  let match: RegExpExecArray | null = boundary.exec(tail);
  while (match) {
    consumed = match.index + match[0].length;
    match = boundary.exec(tail);
  }
  if (consumed > 0) {
    const chunk = tail.slice(0, consumed);
    if (chunk.trim().length >= MIN_SPOKEN_CHUNK) {
      speakChunk(chunk);
      spokenIdx += consumed;
    }
  }
}

/**
 * Feed chat-run events into the talk loop. Called for every gateway chat event
 * after the regular handler ran; `state` is null when the event was for a
 * different session.
 */
export function notifyTalkChatEvent(
  state: "delta" | "final" | "aborted" | "error" | null,
  streamText: string | null,
  finalMessage?: unknown,
) {
  if (phase === "off" || !hooks || !state) {
    return;
  }
  if (state === "delta") {
    if (!runActive) {
      // A run we did not start (typed message, queued item) — speak it too.
      runActive = true;
      if (phase === "listening") {
        setPhase("thinking");
      }
    }
    if (typeof streamText === "string") {
      flushSentences(streamText, false);
    }
    return;
  }
  if (state === "final") {
    runActive = false;
    finalSeen = true;
    const finalText = extractText(finalMessage) ?? lastStreamText;
    if (typeof finalText === "string" && finalText) {
      flushSentences(finalText, true);
    }
    // Nothing speakable in the reply (pure tool run, empty text): listen again.
    if (utterancesPending === 0) {
      resumeListening();
    }
    return;
  }
  // aborted or error: drop whatever is queued and listen again.
  runActive = false;
  finalSeen = false;
  cancelSpeech();
  resumeListening();
}
