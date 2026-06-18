#!/usr/bin/env node
// Test what qwen2.5-coder:14b emits via STREAMING (what the UI actually uses).
// This is what the production code in extensions/ollama/src/stream.ts processes.

const browserToolDef = {
  type: "function",
  function: {
    name: "browser",
    description:
      "Control the browser. REQUIRED WORKFLOW: (1) status (2) start (3) navigate (4) snapshot (5) act.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["status", "start", "stop", "navigate", "snapshot", "act"],
        },
        targetUrl: { type: "string" },
        ref: { type: "string" },
        text: { type: "string" },
      },
      required: ["action"],
    },
  },
};

const res = await fetch("http://localhost:11434/api/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "qwen2.5-coder:14b",
    stream: true,
    messages: [
      {
        role: "system",
        content:
          "You are a browser automation assistant. You have ONE tool: 'browser'. " +
          "When the user asks you to do something on the web, call the tool.",
      },
      {
        role: "user",
        content:
          "Open google.com and type 'weather' in the search box, don't press enter. What is your FIRST tool call?",
      },
    ],
    tools: [browserToolDef],
    options: { temperature: 0.1, num_ctx: 8192 },
  }),
});

if (!res.ok) {
  console.error(`FAIL: Ollama returned ${res.status}: ${await res.text()}`);
  process.exit(1);
}

console.log("=== Streaming chunks ===\n");
const reader = res.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
let accumulatedContent = "";
let nativeToolCalls = [];
let chunkCount = 0;

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    const chunk = JSON.parse(line);
    chunkCount += 1;
    if (chunk.message?.content) {
      accumulatedContent += chunk.message.content;
      process.stdout.write(`[chunk ${chunkCount} content]: ${JSON.stringify(chunk.message.content)}\n`);
    }
    if (chunk.message?.tool_calls) {
      nativeToolCalls.push(...chunk.message.tool_calls);
      process.stdout.write(`[chunk ${chunkCount} TOOL_CALLS]: ${JSON.stringify(chunk.message.tool_calls)}\n`);
    }
    if (chunk.done) {
      process.stdout.write(`[chunk ${chunkCount} DONE]: reason=${chunk.done_reason ?? "n/a"}\n`);
    }
  }
}

console.log("\n=== Summary ===");
console.log(`Total chunks: ${chunkCount}`);
console.log(`Native tool_calls received: ${nativeToolCalls.length}`);
console.log(`Accumulated content length: ${accumulatedContent.length} chars`);
console.log();
console.log("--- Accumulated content (this is what goes through tryParseContentAsToolCall) ---");
console.log(accumulatedContent);
console.log();
console.log("--- Repr ---");
console.log(JSON.stringify(accumulatedContent));
