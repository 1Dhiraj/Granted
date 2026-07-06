// One-shot cost measurement: send a single simple browser task to a FRESH
// session, wait for completion, then report the session's token usage.
import { WebSocket } from "ws";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID, createPublicKey, createPrivateKey, sign } from "node:crypto";

const HOME = "C:/Users/Administrator/.openclaw";
const PORT = 18789;
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const b64url = (b) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
const publicKeyRaw = (pem) =>
  b64url(createPublicKey(pem).export({ type: "spki", format: "der" }).subarray(ED25519_SPKI_PREFIX.length));
const signPayload = (pem, payload) => b64url(sign(null, Buffer.from(payload, "utf8"), createPrivateKey(pem)));

const cfg = JSON.parse(readFileSync(join(HOME, "openclaw.json"), "utf8"));
const token = cfg.gateway?.auth?.token ?? "";
const identity = JSON.parse(readFileSync(join(HOME, "identity", "device.json"), "utf8"));

const SESSION_KEY = `agent:main:cost-test-${Date.now()}`;
const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
const waitFor = (pred, ms = 240000) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    const h = (raw) => {
      let m;
      try { m = JSON.parse(raw.toString()); } catch { return; }
      if (pred(m)) { clearTimeout(t); ws.off("message", h); resolve(m); }
    };
    ws.on("message", h);
  });
const call = async (method, params, ms) => {
  const id = randomUUID();
  ws.send(JSON.stringify({ type: "req", id, method, params }));
  return await waitFor((m) => m.id === id, ms);
};

ws.once("open", async () => {
  try {
    const challenge = await waitFor((m) => m.type === "event" && m.event === "connect.challenge", 15000);
    const nonce = challenge.payload.nonce;
    const signedAtMs = Date.now();
    const payload = ["v3", identity.deviceId, "cli", "cli", "operator", "operator.admin", String(signedAtMs), token, nonce, "win32", ""].join("|");
    const hello = await call("connect", {
      minProtocol: 1, maxProtocol: 10,
      client: { id: "cli", version: "2026.4.7", platform: "win32", mode: "cli" },
      role: "operator", scopes: ["operator.admin"], auth: { token },
      device: { id: identity.deviceId, publicKey: publicKeyRaw(identity.publicKeyPem), signature: signPayload(identity.privateKeyPem, payload), signedAt: signedAtMs, nonce },
    }, 15000);
    if (!hello?.ok) { console.error("CONNECT FAILED:", JSON.stringify(hello?.error)); process.exit(1); }

    console.log("session:", SESSION_KEY);
    const started = Date.now();
    const res = await call("agent", {
      message: "Search google for 'hello' and tell me the title of the first result.",
      sessionKey: SESSION_KEY,
      idempotencyKey: randomUUID(),
      deliver: false,
      channel: "webchat",
    }, 20000);
    console.log("accepted:", JSON.stringify(res?.payload ?? res?.error));
    // Poll session usage until the run goes idle (no growth for 20s), max 4 min.
    let last = null; let stable = 0;
    while (Date.now() - started < 240000) {
      await new Promise((r) => setTimeout(r, 10000));
      const hist = await call("sessions.history", { key: SESSION_KEY, limit: 200 }, 15000).catch(() => null);
      const msgs = hist?.payload?.messages ?? [];
      const sig = msgs.length;
      if (sig === last) { stable++; if (stable >= 2) break; } else { stable = 0; last = sig; }
    }
    console.log("run finished (history stable). messages:", last);
    ws.close(); process.exit(0);
  } catch (err) {
    console.error("ERROR:", String(err)); process.exit(1);
  }
});
