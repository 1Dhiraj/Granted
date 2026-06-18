#!/usr/bin/env node
// Integration test: send a real prompt to qwen2.5-coder:14b via Ollama
// and verify the new content-as-tool-call parser handles its output.
//
// Run: node scripts/test-qwen-tool-call.mjs

// --- INLINE COPY of the parser logic from extensions/ollama/src/stream.ts ---
// Kept in sync manually — if you change extractToolCallShape /
// stripMarkdownCodeFence / extractFirstBalancedJsonObject / tryParseContentAsToolCall
// in stream.ts, update this file too.

function extractToolCallShape(parsed) {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const obj = parsed;

  if (
    typeof obj.name === "string" &&
    obj.name &&
    typeof obj.arguments === "object" &&
    obj.arguments !== null &&
    !Array.isArray(obj.arguments)
  ) {
    return { name: obj.name, arguments: obj.arguments };
  }

  if (
    typeof obj.name === "string" &&
    obj.name &&
    typeof obj.parameters === "object" &&
    obj.parameters !== null &&
    !Array.isArray(obj.parameters)
  ) {
    return { name: obj.name, arguments: obj.parameters };
  }

  if (typeof obj.function === "object" && obj.function !== null && !Array.isArray(obj.function)) {
    const fn = obj.function;
    if (typeof fn.name === "string" && fn.name) {
      let args = fn.arguments ?? fn.parameters ?? {};
      if (typeof args === "string") {
        try {
          args = JSON.parse(args);
        } catch {
          args = {};
        }
      }
      if (typeof args === "object" && args !== null && !Array.isArray(args)) {
        return { name: fn.name, arguments: args };
      }
    }
  }

  if (typeof obj.tool_call === "object" && obj.tool_call !== null) {
    return extractToolCallShape(obj.tool_call);
  }
  if (typeof obj.tool === "string" && obj.tool) {
    const args = obj.arguments ?? obj.args ?? obj.parameters ?? {};
    if (typeof args === "object" && args !== null && !Array.isArray(args)) {
      return { name: obj.tool, arguments: args };
    }
  }
  return null;
}

function stripMarkdownCodeFence(text) {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json|tool_call|tool)?\s*\n?([\s\S]*?)\n?```$/i);
  if (fenceMatch?.[1]) {
    return fenceMatch[1].trim();
  }
  return trimmed;
}

function extractFirstBalancedJsonObject(text) {
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function tryParseContentAsToolCall(text) {
  if (!text) return null;
  const stripped = stripMarkdownCodeFence(text);
  if (stripped.startsWith("{")) {
    try {
      const shape = extractToolCallShape(JSON.parse(stripped));
      if (shape) return shape;
    } catch {}
  }
  const extracted = extractFirstBalancedJsonObject(stripped);
  if (extracted) {
    try {
      const shape = extractToolCallShape(JSON.parse(extracted));
      if (shape) return shape;
    } catch {}
  }
  return null;
}

// --- ORIGINAL parser (for comparison) ---
function originalTryParseContentAsToolCall(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      typeof parsed.name === "string" &&
      parsed.name &&
      typeof parsed.arguments === "object" &&
      parsed.arguments !== null
    ) {
      return { name: parsed.name, arguments: parsed.arguments };
    }
  } catch {}
  return null;
}

// --- TEST RUN ---

const browserToolDef = {
  type: "function",
  function: {
    name: "browser",
    description:
      "Control the browser. REQUIRED WORKFLOW: (1) status (2) start (3) navigate (4) snapshot (5) act. Always navigate before interacting; always snapshot before using element refs.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["status", "start", "stop", "navigate", "snapshot", "act", "tabs", "open"],
          description: "The browser action to perform",
        },
        targetUrl: { type: "string", description: "URL for navigate/open" },
        ref: { type: "string", description: "Element ref from snapshot" },
        text: { type: "string", description: "Text to type" },
      },
      required: ["action"],
    },
  },
};

const userPrompt =
  "Open google.com and type 'weather' in the search box. Do not press enter. " +
  "Take it step by step. What is your FIRST tool call?";

console.log("=== Asking qwen2.5-coder:14b for a browser tool call ===\n");
console.log(`User prompt: ${userPrompt}\n`);

const res = await fetch("http://localhost:11434/api/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "qwen2.5-coder:14b",
    stream: false,
    messages: [
      {
        role: "system",
        content:
          "You are a browser automation assistant. You have ONE tool: 'browser'. " +
          "When the user asks you to do anything on the web, you MUST emit a tool call. " +
          "Do not describe what you would do — call the tool.",
      },
      { role: "user", content: userPrompt },
    ],
    tools: [browserToolDef],
    options: { temperature: 0.1, num_ctx: 8192 },
  }),
});

if (!res.ok) {
  console.error(`FAIL: Ollama returned ${res.status}: ${await res.text()}`);
  process.exit(1);
}

const data = await res.json();
const message = data.message ?? {};
const rawContent = message.content ?? "";
const nativeToolCalls = message.tool_calls ?? [];

console.log("--- Raw model output ---");
console.log(`native tool_calls:  ${JSON.stringify(nativeToolCalls)}`);
console.log(`content (raw):      ${JSON.stringify(rawContent)}`);
console.log();
console.log("--- Content rendered ---");
console.log(rawContent || "(empty)");
console.log();

if (nativeToolCalls.length > 0) {
  console.log("[INFO] Model used NATIVE tool_calls — parser fallback not needed for this run.");
  console.log("       But we still want to verify the parser handles the content path,");
  console.log("       since the user's screenshot showed content-as-JSON.");
}

if (!rawContent && nativeToolCalls.length === 0) {
  console.error("[FAIL] Empty response.");
  process.exit(1);
}

if (rawContent) {
  console.log("--- Parser comparison (OLD vs NEW) ---");
  const oldResult = originalTryParseContentAsToolCall(rawContent);
  const newResult = tryParseContentAsToolCall(rawContent);

  console.log(`OLD parser: ${oldResult ? "DETECTED" : "MISSED"}`);
  if (oldResult)
    console.log(`            name=${oldResult.name} args=${JSON.stringify(oldResult.arguments)}`);
  console.log(`NEW parser: ${newResult ? "DETECTED" : "MISSED"}`);
  if (newResult)
    console.log(`            name=${newResult.name} args=${JSON.stringify(newResult.arguments)}`);
  console.log();

  if (!oldResult && newResult) {
    console.log("[PASS] NEW parser fixes a case the OLD parser missed.");
    process.exit(0);
  }
  if (oldResult && newResult) {
    console.log("[PASS] Both parsers detected the tool call. New parser is backward compatible.");
    process.exit(0);
  }
  if (!newResult) {
    console.error("[FAIL] NEW parser did not detect a tool call in the content.");
    process.exit(1);
  }
} else {
  console.log("[INFO] No content to parse (model used native tool_calls).");
}
