/**
 * Wake word: background listening for a user-set phrase ("hey granted") that
 * activates talk mode hands-free. Runs only while talk mode is OFF; talk mode
 * owns the mic once it starts. The phrase and on/off state persist per browser.
 */

import { isSttSupported, startStt, stopStt } from "./speech.ts";
import { isTalkActive, startTalk } from "./talk-mode.ts";

const PHRASE_KEY = "openclaw.wakeWord.phrase";
const ENABLED_KEY = "openclaw.wakeWord.enabled";
const DEFAULT_PHRASE = "hey granted";
/** If STT dies this many times within RESTART_WINDOW_MS, give up (mic broken). */
const MAX_RESTARTS = 4;
const RESTART_WINDOW_MS = 5000;

type WakeHooks = {
  send: (text: string) => void;
  requestUpdate: () => void;
};

let hooks: WakeHooks | null = null;
let listening = false;
let guardTimer: ReturnType<typeof setInterval> | null = null;
let restartTimestamps: number[] = [];

export function getWakePhrase(): string {
  try {
    return localStorage.getItem(PHRASE_KEY)?.trim() || DEFAULT_PHRASE;
  } catch {
    return DEFAULT_PHRASE;
  }
}

export function setWakePhrase(phrase: string) {
  try {
    localStorage.setItem(PHRASE_KEY, phrase.trim().toLowerCase());
  } catch {
    // localStorage unavailable (private mode) — wake word just won't persist.
  }
}

export function isWakeEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

export function isWakeSupported(): boolean {
  return isSttSupported();
}

/** True when the background mic is actually armed right now. */
export function isWakeListening(): boolean {
  return listening;
}

let initialized = false;

/**
 * Re-arms wake listening after a page reload if it was left enabled.
 * Safe to call from render: acts at most once and never triggers an update.
 */
export function ensureWakeInit(next: WakeHooks) {
  if (initialized) {
    return;
  }
  initialized = true;
  if (!isWakeEnabled() || !isWakeSupported()) {
    return;
  }
  hooks = next;
  restartTimestamps = [];
  armIfIdle();
  if (!guardTimer) {
    guardTimer = setInterval(armIfIdle, 2000);
  }
}

export function enableWakeWord(next: WakeHooks) {
  initialized = true;
  try {
    localStorage.setItem(ENABLED_KEY, "1");
  } catch {
    /* non-persistent */
  }
  hooks = next;
  restartTimestamps = [];
  armIfIdle();
  if (!guardTimer) {
    // Re-arms the mic whenever talk mode releases it (there is no talk-ended
    // callback, so a light poll keeps the hand-off robust).
    guardTimer = setInterval(armIfIdle, 2000);
  }
  hooks.requestUpdate();
}

export function disableWakeWord() {
  try {
    localStorage.setItem(ENABLED_KEY, "0");
  } catch {
    /* non-persistent */
  }
  if (guardTimer) {
    clearInterval(guardTimer);
    guardTimer = null;
  }
  if (listening) {
    listening = false;
    stopStt();
  }
  hooks?.requestUpdate();
  hooks = null;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function armIfIdle() {
  if (!hooks || !isWakeEnabled() || listening || isTalkActive()) {
    return;
  }
  const phrase = normalize(getWakePhrase());
  if (!phrase) {
    return;
  }
  listening = startStt({
    onTranscript: (text) => {
      if (!listening || isTalkActive()) {
        return;
      }
      if (normalize(text).includes(phrase)) {
        onWake();
      }
    },
    onEnd: () => {
      // Browser STT sessions end on their own every ~60s; restart unless broken.
      listening = false;
      const now = Date.now();
      restartTimestamps = restartTimestamps.filter((t) => now - t < RESTART_WINDOW_MS);
      restartTimestamps.push(now);
      if (restartTimestamps.length <= MAX_RESTARTS) {
        setTimeout(armIfIdle, 250);
      }
    },
    onError: () => {
      listening = false;
    },
  });
}

function onWake() {
  const activeHooks = hooks;
  if (!activeHooks) {
    return;
  }
  listening = false;
  stopStt();
  startTalk({
    send: activeHooks.send,
    requestUpdate: activeHooks.requestUpdate,
  });
  activeHooks.requestUpdate();
}
