// Abort the in-flight run on agent:main:main
import { WebSocket } from "ws";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID, createPrivateKey, createPublicKey, sign } from "node:crypto";

const IDENTITY_DIR = "C:/Users/Administrator/.openclaw/identity";
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
const publicKeyRaw = (pem) => b64url(createPublicKey(pem).export({ type: "spki", format: "der" }).subarray(ED25519_SPKI_PREFIX.length));
const signPayload = (pem, payload) => b64url(sign(null, Buffer.from(payload, "utf8"), createPrivateKey(pem)));

const identity = JSON.parse(readFileSync(join(IDENTITY_DIR, "device.json"), "utf8"));
const gatewayToken = JSON.parse(readFileSync("C:/Users/Administrator/.openclaw/openclaw.json", "utf8")).gateway?.auth?.token;

const ws = new WebSocket("ws://127.0.0.1:7071");
const waitFor = (pred, ms = 15000) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("timeout")), ms);
  const h = (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (pred(m)) { clearTimeout(t); ws.off("message", h); resolve(m); }
  };
  ws.on("message", h);
});

ws.once("open", async () => {
  const challenge = await waitFor((m) => m.type === "event" && m.event === "connect.challenge");
  const nonce = challenge.payload.nonce;
  const signedAtMs = Date.now();
  const payload = ["v3", identity.deviceId, "cli", "cli", "operator", "operator.admin", String(signedAtMs), gatewayToken ?? "", nonce, "win32", ""].join("|");
  const cid = randomUUID();
  ws.send(JSON.stringify({
    type: "req", id: cid, method: "connect",
    params: {
      minProtocol: 1, maxProtocol: 10,
      client: { id: "cli", version: "2026.4.7", platform: "win32", mode: "cli" },
      role: "operator", scopes: ["operator.admin"], auth: { token: gatewayToken },
      device: { id: identity.deviceId, publicKey: publicKeyRaw(identity.publicKeyPem), signature: signPayload(identity.privateKeyPem, payload), signedAt: signedAtMs, nonce },
    },
  }));
  const hello = await waitFor((m) => m.id === cid);
  if (!hello?.ok) { console.error("connect failed", JSON.stringify(hello?.error)); process.exit(1); }
  const aid = randomUUID();
  ws.send(JSON.stringify({ type: "req", id: aid, method: "sessions.abort", params: { key: "agent:main:main" } }));
  const res = await waitFor((m) => m.id === aid);
  console.log("abort result:", JSON.stringify(res?.payload ?? res?.error));
  ws.close();
  process.exit(0);
});
