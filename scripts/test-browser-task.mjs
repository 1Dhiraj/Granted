/**
 * Test script: resets the session, sends browser task, verifies model calls act(type).
 *
 * Usage: node scripts/test-browser-task.mjs
 */
import { WebSocket } from "ws";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { randomUUID, createPrivateKey, createPublicKey, sign } from "node:crypto";

const PORT = 7071;
const SESSIONS_DIR = "C:/Users/Administrator/.openclaw/agents/main/sessions";
const IDENTITY_DIR = "C:/Users/Administrator/.openclaw/identity";
const TASK = process.argv[2] || "open google.com and type weather in the search box. do not press enter.";
const WATCH_MS = Number(process.argv[3]) || 240_000;

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function b64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
function publicKeyRaw(pem) {
  const key = createPublicKey(pem);
  const spki = key.export({ type: "spki", format: "der" });
  return b64url(spki.subarray(ED25519_SPKI_PREFIX.length));
}
function signPayload(pem, payload) {
  return b64url(sign(null, Buffer.from(payload, "utf8"), createPrivateKey(pem)));
}
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
  const gatewayToken = JSON.parse(
    readFileSync("C:/Users/Administrator/.openclaw/openclaw.json", "utf8")
  ).gateway?.auth?.token;

  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
  const challenge = await waitFor(ws, (m) => m.type === "event" && m.event === "connect.challenge");
  const nonce = challenge.payload.nonce;

  const clientId = "cli", clientMode = "cli", role = "operator";
  const scopes = ["operator.admin"];
  const signedAtMs = Date.now();
  const payload = buildPayloadV3({ deviceId: identity.deviceId, clientId, clientMode, role, scopes, signedAtMs, token: gatewayToken, nonce });

  const cid = randomUUID();
  ws.send(JSON.stringify({
    type: "req", id: cid, method: "connect",
    params: {
      minProtocol: 1, maxProtocol: 10,
      client: { id: clientId, version: "2026.4.7", platform: "win32", mode: clientMode },
      role, scopes, auth: { token: gatewayToken },
      device: {
        id: identity.deviceId,
        publicKey: publicKeyRaw(identity.publicKeyPem),
        signature: signPayload(identity.privateKeyPem, payload),
        signedAt: signedAtMs, nonce
      }
    }
  }));
  const hello = await waitFor(ws, (m) => m.id === cid);
  if (!hello?.ok) throw new Error("Connect failed: " + JSON.stringify(hello?.error));
  return { ws, gatewayToken };
}

async function main() {
  console.log("Connecting...");
  const { ws } = await connectGateway();
  console.log("Connected to gateway");

  const sessionKey = "agent:main:main";

  // Find current session file and record baseline line count (no reset - reset breaks initialization)
  const allFiles = readdirSync(SESSIONS_DIR).filter(f => f.endsWith(".jsonl"));
  const sessionFiles = allFiles.map(f => ({
    name: f,
    mtime: statSync(join(SESSIONS_DIR, f)).mtimeMs,
  })).sort((a, b) => b.mtime - a.mtime);
  const baselineFile = sessionFiles[0]?.name ?? null;
  let baselineLines = 0;
  if (baselineFile) {
    try {
      baselineLines = readFileSync(join(SESSIONS_DIR, baselineFile), "utf8").split("\n").filter(Boolean).length;
    } catch {}
  }
  console.log(`Baseline: ${baselineFile} @ ${baselineLines} lines`);

  // Send the task
  const sendId = randomUUID();
  ws.send(JSON.stringify({
    type: "req", id: sendId, method: "sessions.send",
    params: { key: sessionKey, message: TASK }
  }));
  const sendRes = await waitFor(ws, (m) => m.id === sendId, 15000).catch(() => null);
  if (!sendRes?.ok) {
    console.error("Send failed:", JSON.stringify(sendRes?.error ?? sendRes));
    ws.close(); return;
  }
  console.log(`\nSent task. runId=${sendRes.payload?.runId}\nWatching session log (240s)...\n`);

  const deadline = Date.now() + WATCH_MS;
  let watchTarget = baselineFile;
  let reported = false;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2000));

    // Find most recently modified session file
    const newest = readdirSync(SESSIONS_DIR)
      .filter(f => f.endsWith(".jsonl"))
      .map(f => ({ name: f, mtime: statSync(join(SESSIONS_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)[0];
    if (!newest) { process.stdout.write("."); continue; }

    if (newest.name !== watchTarget) {
      if (watchTarget) console.log(`\nNow watching: ${newest.name}`);
      else console.log(`Watching: ${newest.name}`);
      watchTarget = newest.name;
      baselineLines = 0; // new file, start from beginning
    }

    let allLines;
    try { allLines = readFileSync(join(SESSIONS_DIR, newest.name), "utf8").split("\n").filter(Boolean); }
    catch { process.stdout.write("."); continue; }

    // Only look at lines added AFTER this test run started
    const newLines = allLines.slice(baselineLines);

    // Look for act tool calls (the real success: model is typing)
    const actCalls = newLines.filter(l => {
      try {
        const p = JSON.parse(l);
        return p?.message?.content?.some(c =>
          c.type === "toolCall" && c.name === "browser" &&
          c.arguments?.action === "act"
        );
      } catch { return false; }
    });

    // Look for any browser tool calls (navigation/snapshot)
    const browserCalls = newLines.filter(l => {
      try { const p = JSON.parse(l); return p?.message?.content?.some(c => c.type === "toolCall" && c.name === "browser"); }
      catch { return false; }
    });

    // Look for circuit breaker error
    const circuitBreaker = newLines.filter(l => {
      try {
        const p = JSON.parse(l);
        return p?.message?.content?.some(c =>
          (c.type === "toolResult" || c.type === "text") &&
          JSON.stringify(c.result ?? c.text ?? "").includes("CRITICAL")
        );
      } catch { return false; }
    });

    // Look for JSON text output (broken behavior)
    const badText = newLines.filter(l => {
      try {
        const p = JSON.parse(l);
        return p?.message?.role === "assistant" && p?.message?.stopReason === "stop" &&
          p?.message?.content?.some(c => c.type === "text" && c.text?.includes('"action"'));
      } catch { return false; }
    });

    // Look for final stop (task done or given up)
    const finalStop = newLines.filter(l => {
      try {
        const p = JSON.parse(l);
        return p?.message?.role === "assistant" && p?.message?.stopReason === "stop";
      } catch { return false; }
    });

    if (circuitBreaker.length > 0 && !reported) {
      reported = true;
      console.log(`\n\n⚠️  Circuit breaker triggered! Continuing to watch...`);
      try {
        const p = JSON.parse(circuitBreaker[0]);
        const c = p?.message?.content?.find(x => (x.text ?? JSON.stringify(x.result ?? "")).includes("CRITICAL"));
        console.log("Error:", (c?.text ?? JSON.stringify(c?.result ?? "")).slice(0, 200));
      } catch {}
    }

    if (actCalls.length > 0) {
      console.log(`\n\n✅ SUCCESS: Model called act (typing)!`);
      for (const line of actCalls) {
        try {
          const p = JSON.parse(line);
          for (const c of p.message.content.filter(c => c.type === "toolCall" && c.name === "browser")) {
            console.log("  browser(" + JSON.stringify(c.arguments) + ")");
          }
        } catch {}
      }
      console.log(`\nAll browser calls in this run:`);
      for (const line of browserCalls) {
        try {
          const p = JSON.parse(line);
          for (const c of p.message.content.filter(c => c.type === "toolCall" && c.name === "browser")) {
            console.log("  browser(" + JSON.stringify(c.arguments) + ")");
          }
        } catch {}
      }
      ws.close(); return;
    }

    if (badText.length > 0 && !reported) {
      reported = true;
      console.log(`\n\n❌ STILL BROKEN: Model outputting JSON text (not tool calls)`);
      const line = badText[0];
      const p = JSON.parse(line);
      const t = p.message.content.find(c => c.type === "text")?.text ?? "";
      console.log("Text output:", t.slice(0, 300));
    }

    // Check if model stopped without calling act
    if (finalStop.length > 0 && browserCalls.length > 0 && actCalls.length === 0) {
      const lastStop = finalStop[finalStop.length - 1];
      try {
        const p = JSON.parse(lastStop);
        const text = p.message.content.find(c => c.type === "text")?.text ?? "";
        console.log(`\n\n❌ Model stopped after browser calls without calling act!`);
        console.log(`  Stop text: "${text.slice(0, 150)}"`);
        console.log(`  Browser calls made: ${browserCalls.length}`);
        console.log(`  Act calls made: 0`);
        // Continue watching in case there's more
      } catch {}
    }

    process.stdout.write(newLines.length > 0 ? "+" : ".");
  }

  console.log("\n\nTimeout reached. Dumping new lines from session:");
  if (watchTarget) {
    try {
      const allLines = readFileSync(join(SESSIONS_DIR, watchTarget), "utf8").split("\n").filter(Boolean);
      const newLines = allLines.slice(baselineLines);
      for (const l of newLines.slice(-10)) {
        try {
          const p = JSON.parse(l);
          const c = p?.message?.content?.map(x => {
            if (x.type === "toolCall") return `toolCall:${x.name}(${JSON.stringify(x.arguments).slice(0,60)})`;
            if (x.type === "toolResult") return `toolResult:${x.toolName}(${JSON.stringify(x.result ?? "").slice(0,60)})`;
            if (x.type === "text") return `text(${(x.text??'').slice(0,60)})`;
            return x.type;
          }).join(", ") ?? "";
          console.log(" ", p.type ?? "", p.message?.role ?? "", p.message?.stopReason ?? "", c);
        } catch {}
      }
    } catch {}
  }
  ws.close();
}

main().catch(err => { console.error("Error:", err.message); process.exit(1); });
