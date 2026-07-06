// Pretty-print the tail of the gateway rolling log.
import { readFileSync } from "node:fs";

const file = process.argv[2] ?? "D:/tmp/openclaw/openclaw-2026-07-03.log";
const count = Number(process.argv[3] ?? 15);
const lines = readFileSync(file, "utf8").trim().split("\n");
const ansiRe = new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g");
for (const l of lines.slice(-count)) {
  try {
    const j = JSON.parse(l);
    const msg = [j["0"], j["1"], j["2"], j["3"]]
      .filter((x) => x !== undefined)
      .map((x) => (typeof x === "string" ? x : JSON.stringify(x)))
      .join(" ")
      .replace(ansiRe, "");
    console.log(j.time?.slice(11, 19), "|", msg.slice(0, 220));
  } catch {
    console.log("RAW", l.slice(0, 160));
  }
}
