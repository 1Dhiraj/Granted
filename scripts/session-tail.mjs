// Pretty-print the tail of a Pi session jsonl: roles, text, tool calls.
import { readFileSync } from "node:fs";

const file = process.argv[2];
const count = Number(process.argv[3] ?? 12);
const lines = readFileSync(file, "utf8").trim().split("\n");
for (const l of lines.slice(-count)) {
  let j;
  try {
    j = JSON.parse(l);
  } catch {
    continue;
  }
  const m = j.message ?? j;
  const role = m.role ?? j.type ?? "?";
  let text = "";
  const c = m.content;
  if (typeof c === "string") text = c;
  else if (Array.isArray(c)) {
    text = c
      .map((b) => {
        if (b.type === "text") return b.text;
        if (b.type === "toolCall" || b.type === "tool_use")
          return `[tool:${b.name ?? b.toolName} ${JSON.stringify(b.input ?? b.arguments ?? {}).slice(0, 140)}]`;
        if (b.type === "toolResult" || b.type === "tool_result")
          return `[result:${JSON.stringify(b.content ?? b.output ?? "").slice(0, 140)}]`;
        return `[${b.type}]`;
      })
      .join(" ");
  }
  const usage = m.usage ? ` usage(in=${m.usage.input ?? "?"},cr=${m.usage.cacheRead ?? "?"},out=${m.usage.output ?? "?"})` : "";
  console.log(`${(j.timestamp ?? "").slice(11, 19)} ${role}${usage}: ${text.slice(0, 260)}`);
}
