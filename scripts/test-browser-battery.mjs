/**
 * Browser-agent capability battery: sends multiple categorized tasks to the
 * gateway (one main session), classifies each outcome from the session log,
 * and prints a per-category capability summary.
 *
 * Usage: node scripts/test-browser-battery.mjs
 */
import { WebSocket } from "ws";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { randomUUID, createPrivateKey, createPublicKey, sign } from "node:crypto";

const PORT = 7071;
const SESSIONS_DIR = "C:/Users/Administrator/.openclaw/agents/main/sessions";
const IDENTITY_DIR = "C:/Users/Administrator/.openclaw/identity";
const PER_TASK_TIMEOUT_MS = 150_000;

// The capability battery (category -> task)
const TASKS = [
  { cat: "Navigation", task: "open github.com" },
  { cat: "Search+Type", task: "open google.com and type weather in the search box. do not press enter." },
  { cat: "Multi-step", task: "open google.com, type OpenAI in the search box, then tell me what you typed." },
  { cat: "Reading", task: "open example.com and tell me the exact main heading text shown on the page." },
  { cat: "Clicking", task: "open github.com and click the Sign in link." },
];

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
function b64url(buf) { return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, ""); }
function publicKeyRaw(pem) {
  const key = createPublicKey(pem);
  const spki = key.export({ type: "spki", format: "der" });
  return b64url(spki.subarray(ED25519_SPKI_PREFIX.length));
}
function signPayload(pem, payload) { return b64url(sign(null, Buffer.from(payload, "utf8"), createPrivateKey(pem))); }
function buildPayloadV3(p) {
  return ["v3", p.deviceId, p.clientId, p.clientMode, p.role, p.scopes.join(","),
    String(p.signedAtMs), p.token ?? "", p.nonce, "win32", ""].join("|");
}
function waitFor(ws, pred, ms = 30000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    const h = (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (pred(m)) { clearTimeout(t); ws.off("message", h); resolve(m); }
    };
    ws.on("message", h);
  });
}

async function connectGateway() {
  const identity = JSON.parse(readFileSync(join(IDENTITY_DIR, "device.json"), "utf8"));
  const gatewayToken = JSON.parse(readFileSync("C:/Users/Administrator/.openclaw/openclaw.json", "utf8")).gateway?.auth?.token;
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
  const challenge = await waitFor(ws, (m) => m.type === "event" && m.event === "connect.challenge");
  const nonce = challenge.payload.nonce;
  const clientId = "cli", clientMode = "cli", role = "operator", scopes = ["operator.admin"];
  const signedAtMs = Date.now();
  const payload = buildPayloadV3({ deviceId: identity.deviceId, clientId, clientMode, role, scopes, signedAtMs, token: gatewayToken, nonce });
  const cid = randomUUID();
  ws.send(JSON.stringify({
    type: "req", id: cid, method: "connect",
    params: {
      minProtocol: 1, maxProtocol: 10,
      client: { id: clientId, version: "2026.4.7", platform: "win32", mode: clientMode },
      role, scopes, auth: { token: gatewayToken },
      device: { id: identity.deviceId, publicKey: publicKeyRaw(identity.publicKeyPem), signature: signPayload(identity.privateKeyPem, payload), signedAt: signedAtMs, nonce }
    }
  }));
  const hello = await waitFor(ws, (m) => m.id === cid);
  if (!hello?.ok) throw new Error("Connect failed: " + JSON.stringify(hello?.error));
  return { ws, gatewayToken };
}

function newestSessionFile() {
  const files = readdirSync(SESSIONS_DIR).filter(f => f.endsWith(".jsonl"))
    .map(f => ({ name: f, mtime: statSync(join(SESSIONS_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return files[0]?.name ?? null;
}
function lineCount(file) {
  try { return readFileSync(join(SESSIONS_DIR, file), "utf8").split("\n").filter(Boolean).length; } catch { return 0; }
}

function analyze(newLines) {
  const browserCalls = [], actionKinds = [];
  let jsonTextBroken = false, heartbeatBroken = false, circuitBreaker = false, finalText = "";
  for (const l of newLines) {
    let p; try { p = JSON.parse(l); } catch { continue; }
    const content = p?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (c.type === "toolCall" && c.name === "browser") {
        browserCalls.push(c.arguments);
        const k = c.arguments?.action ?? c.arguments?.kind;
        if (k) actionKinds.push(k);
      }
      if (c.type === "text" && typeof c.text === "string") {
        if (p?.message?.role === "assistant" && p?.message?.stopReason === "stop") {
          finalText = c.text.slice(0, 120);
          if (c.text.includes('"action"') || c.text.trim().startsWith("{")) jsonTextBroken = true;
          if (c.text.includes("HEARTBEAT_OK")) heartbeatBroken = true;
        }
      }
      if ((c.type === "toolResult" || c.type === "text") && JSON.stringify(c.result ?? c.text ?? "").includes("CRITICAL")) circuitBreaker = true;
    }
  }
  return { browserCalls, actionKinds, jsonTextBroken, heartbeatBroken, circuitBreaker, finalText };
}

function classify(a) {
  if (a.circuitBreaker) return "CIRCUIT_BREAKER";
  if (a.jsonTextBroken) return "BROKEN_JSON_TEXT";
  if (a.heartbeatBroken) return "BROKEN_HEARTBEAT_OK";
  if (a.browserCalls.length === 0) return "NO_TOOL_CALLS";
  const acted = a.actionKinds.some(k => ["act", "type", "click", "clickAt"].includes(k));
  if (acted && a.finalText) return "SUCCESS";
  if (a.browserCalls.length > 0 && a.finalText) return "PARTIAL_COMPLETED";
  if (a.browserCalls.length > 0) return "STALLED_NO_FINAL";
  return "UNKNOWN";
}

async function runTask(ws, idx, item) {
  const baselineFile = newestSessionFile();
  let baselineLines = baselineFile ? lineCount(baselineFile) : 0;
  let watchTarget = baselineFile;

  const sendId = randomUUID();
  ws.send(JSON.stringify({ type: "req", id: sendId, method: "sessions.send", params: { key: "agent:main:main", message: item.task } }));
  const sendRes = await waitFor(ws, (m) => m.id === sendId, 15000).catch(() => null);
  if (!sendRes?.ok) return { ...item, outcome: "SEND_FAILED", detail: JSON.stringify(sendRes?.error ?? "") };

  const deadline = Date.now() + PER_TASK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2500));
    const newest = newestSessionFile();
    if (newest && newest !== watchTarget) { watchTarget = newest; baselineLines = 0; }
    if (!watchTarget) continue;
    const all = readFileSync(join(SESSIONS_DIR, watchTarget), "utf8").split("\n").filter(Boolean);
    const newLines = all.slice(baselineLines);
    const a = analyze(newLines);
    // Consider the task "settled" once we have a final assistant stop AND no more growth for a beat
    if (a.finalText && (a.actionKinds.length > 0 || a.jsonTextBroken || a.heartbeatBroken)) {
      const outcome = classify(a);
      if (outcome !== "STALLED_NO_FINAL") {
        return { ...item, outcome, calls: a.browserCalls.length, kinds: [...new Set(a.actionKinds)].join("/"), finalText: a.finalText };
      }
    }
    if (a.circuitBreaker) return { ...item, outcome: "CIRCUIT_BREAKER", calls: a.browserCalls.length };
  }
  // timeout: final classification from whatever we have
  const all = watchTarget ? readFileSync(join(SESSIONS_DIR, watchTarget), "utf8").split("\n").filter(Boolean) : [];
  const a = analyze(all.slice(baselineLines));
  return { ...item, outcome: a.browserCalls.length ? classify(a) : "TIMEOUT_NO_RESPONSE", calls: a.browserCalls.length, kinds: [...new Set(a.actionKinds)].join("/"), finalText: a.finalText };
}

async function main() {
  console.log("Connecting...");
  const { ws } = await connectGateway();
  console.log("Connected. Running battery of " + TASKS.length + " tasks (per-task timeout " + (PER_TASK_TIMEOUT_MS/1000) + "s)\n");
  const results = [];
  for (let i = 0; i < TASKS.length; i++) {
    console.log(`[${i+1}/${TASKS.length}] ${TASKS[i].cat}: "${TASKS[i].task}"`);
    const r = await runTask(ws, i, TASKS[i]);
    results.push(r);
    console.log(`    -> ${r.outcome}  (calls=${r.calls ?? 0} kinds=${r.kinds ?? "-"})  final="${r.finalText ?? ""}"\n`);
  }
  console.log("\n================ BATTERY SUMMARY ================");
  for (const r of results) {
    const mark = r.outcome === "SUCCESS" ? "PASS" : (r.outcome.startsWith("BROKEN") || r.outcome.includes("TIMEOUT") || r.outcome === "NO_TOOL_CALLS" || r.outcome === "CIRCUIT_BREAKER") ? "FAIL" : "PARTIAL";
    console.log(`  [${mark}] ${r.cat.padEnd(12)} ${r.outcome.padEnd(20)} calls=${r.calls ?? 0} kinds=${r.kinds ?? "-"}`);
  }
  const pass = results.filter(r => r.outcome === "SUCCESS").length;
  console.log(`\n  SUCCESS: ${pass}/${results.length}`);
  console.log("================================================");
  ws.close();
}
main().catch(err => { console.error("Error:", err.message); process.exit(1); });
