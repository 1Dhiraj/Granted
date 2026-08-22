import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Exact-value redaction for credentials this machine actually holds.
 *
 * The pattern layer in `redact.ts` catches secrets that *look* like secrets —
 * `sk-...`, `Bearer ...`, `"apiKey": "..."`. It cannot catch a bare token that
 * appears on its own, with no surrounding shape to match, which is exactly what
 * happens when a file holding one credential per line is read back verbatim.
 *
 * These values are known strings, so matching them needs no guessing and
 * produces no false positives: either the text contains the live API key or it
 * does not. That makes this a safe complement to the heuristics rather than a
 * replacement for them.
 */

const MIN_SECRET_LENGTH = 16;
const CACHE_TTL_MS = 30_000;

type SecretCache = { values: string[]; loadedAt: number };
let cache: SecretCache | null = null;

function authProfilesPaths(): string[] {
  const home = os.homedir();
  const base = path.join(home, ".openclaw", "agents");
  const paths: string[] = [];
  let agents: string[] = [];
  try {
    agents = fs.readdirSync(base, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return paths;
  }
  for (const agent of agents) {
    paths.push(path.join(base, agent, "agent", "auth-profiles.json"));
  }
  return paths;
}

/** Pull every credential-shaped string value out of a parsed profile blob. */
function collectStringsDeep(value: unknown, out: Set<string>, depth = 0): void {
  if (depth > 6 || !value) {
    return;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    // Short values are words, ids and model names, not credentials; redacting
    // them would blank out legitimate text everywhere.
    if (trimmed.length >= MIN_SECRET_LENGTH) {
      out.add(trimmed);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStringsDeep(item, out, depth + 1);
    }
    return;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectStringsDeep(item, out, depth + 1);
    }
  }
}

export function collectKnownSecretValues(now = Date.now()): string[] {
  if (cache && now - cache.loadedAt < CACHE_TTL_MS) {
    return cache.values;
  }
  const found = new Set<string>();
  for (const file of authProfilesPaths()) {
    let raw: string;
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    try {
      collectStringsDeep(JSON.parse(raw), found);
    } catch {
      // A corrupt profile file must not break logging or replies.
    }
  }
  // Longest first, so a key that contains another key is masked whole.
  const values = [...found].sort((a, b) => b.length - a.length);
  cache = { values, loadedAt: now };
  return values;
}

/** Test seam: forget cached credentials. */
export function resetKnownSecretCache(): void {
  cache = null;
}

export function redactKnownSecrets(text: string, secrets?: readonly string[]): string {
  if (!text) {
    return text;
  }
  const values = secrets ?? collectKnownSecretValues();
  if (!values.length) {
    return text;
  }
  let out = text;
  for (const secret of values) {
    if (!secret || !out.includes(secret)) {
      continue;
    }
    // Keep a short prefix so a human can still tell WHICH credential appeared;
    // that is the difference between a useful log line and an unreadable one.
    const hint = secret.slice(0, 4);
    out = out.split(secret).join(`${hint}…[redacted]`);
  }
  return out;
}
