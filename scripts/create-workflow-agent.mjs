// Create the "Email to Notion" browser-driven workflow agent via the live gateway.
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

const PURPOSE = `You turn incoming emails into Notion pages by DRIVING THE WEB BROWSER — you use no API keys, just the browser tool and the user's existing logged-in sessions.

Each run, follow the criteria in your task message (which sender to watch, where in Notion to file):
1. Open Gmail (https://mail.google.com) with the browser. Navigate, then snapshot before acting.
2. Find new UNREAD emails matching the sender/criteria in your task.
3. For each match: open it, read the subject and body. Then open Notion (https://www.notion.so), create a NEW page in the location named in your task, set the title to the email subject, and put the body into the page.
4. Back in Gmail, mark that email as READ so it is never processed twice.

Browser rules: navigate -> snapshot -> act using ONLY refs from the latest snapshot; re-snapshot after every change; never reuse old refs. If you land on a login screen, STOP and tell the user to log in (do not attempt credentials). Never delete emails or Notion content. When done, report exactly which pages you created.`;

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
    const created = await call("agents.create", {
      name: "Email to Notion",
      purpose: PURPOSE,
      model: "together/moonshotai/Kimi-K2.6",
      tools: ["browser"],
    });
    console.log("CREATE:", JSON.stringify(created?.payload ?? created?.error));
    ws.close();
    process.exit(created?.ok ? 0 : 1);
  } catch (err) {
    console.error("ERROR:", String(err));
    process.exit(1);
  }
});
