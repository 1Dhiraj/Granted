// Delete an agent by id via the live gateway: node scripts/delete-agent.mjs <agentId>
import { WebSocket } from "ws";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID, createPublicKey, createPrivateKey, sign } from "node:crypto";

const HOME = "C:/Users/Administrator/.openclaw";
const PORT = 18789;
const agentId = process.argv[2];
if (!agentId) {
  console.error("usage: node scripts/delete-agent.mjs <agentId>");
  process.exit(1);
}
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const b64url = (b) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
const publicKeyRaw = (pem) =>
  b64url(createPublicKey(pem).export({ type: "spki", format: "der" }).subarray(ED25519_SPKI_PREFIX.length));
const signPayload = (pem, payload) => b64url(sign(null, Buffer.from(payload, "utf8"), createPrivateKey(pem)));

const cfg = JSON.parse(readFileSync(join(HOME, "openclaw.json"), "utf8"));
const token = cfg.gateway?.auth?.token ?? "";
const identity = JSON.parse(readFileSync(join(HOME, "identity", "device.json"), "utf8"));

const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
const waitFor = (pred, ms = 15000) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    const h = (raw) => {
      let m;
      try {
        m = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (pred(m)) {
        clearTimeout(t);
        ws.off("message", h);
        resolve(m);
      }
    };
    ws.on("message", h);
  });
const call = async (method, params) => {
  const id = randomUUID();
  ws.send(JSON.stringify({ type: "req", id, method, params }));
  return waitFor((m) => m.id === id);
};

ws.once("open", async () => {
  try {
    const challenge = await waitFor((m) => m.type === "event" && m.event === "connect.challenge");
    const nonce = challenge.payload.nonce;
    const signedAtMs = Date.now();
    const payload = ["v3", identity.deviceId, "cli", "cli", "operator", "operator.admin", String(signedAtMs), token, nonce, "win32", ""].join("|");
    const hello = await call("connect", {
      minProtocol: 1,
      maxProtocol: 10,
      client: { id: "cli", version: "2026.4.7", platform: "win32", mode: "cli" },
      role: "operator",
      scopes: ["operator.admin"],
      auth: { token },
      device: {
        id: identity.deviceId,
        publicKey: publicKeyRaw(identity.publicKeyPem),
        signature: signPayload(identity.privateKeyPem, payload),
        signedAt: signedAtMs,
        nonce,
      },
    });
    if (!hello?.ok) {
      console.error("CONNECT FAILED:", JSON.stringify(hello?.error));
      process.exit(1);
    }
    const del = await call("agents.delete", { agentId });
    console.log("DELETE:", JSON.stringify(del?.payload ?? del?.error));
    ws.close();
    process.exit(del?.ok ? 0 : 1);
  } catch (err) {
    console.error("ERROR:", String(err));
    process.exit(1);
  }
});
