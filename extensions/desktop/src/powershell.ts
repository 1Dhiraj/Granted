import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Runs a PowerShell script and parses the last stdout line as JSON. Dynamic
 * arguments are passed through the OPENCLAW_DESKTOP_ARGS environment variable
 * so scripts stay static.
 *
 * Scripts are written once to hash-named temp .ps1 files and executed with
 * -File: passing them inline via -EncodedCommand put the whole script on the
 * command line, which overflowed the Windows ~32K command-line limit
 * (spawn ENAMETOOLONG) once the scripts grew.
 */

const scriptFileCache = new Map<string, string>();

function resolveScriptFile(script: string): string {
  const cached = scriptFileCache.get(script);
  if (cached && fs.existsSync(cached)) {
    return cached;
  }
  const hash = crypto.createHash("md5").update(script).digest("hex").slice(0, 12);
  const dir = path.join(os.tmpdir(), "openclaw-desktop-scripts");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `desk-${hash}.ps1`);
  if (!fs.existsSync(file)) {
    // BOM forces Windows PowerShell 5.1 to read the file as UTF-8; without it
    // the parser assumes ANSI and garbles non-ASCII characters in hint strings.
    fs.writeFileSync(file, `﻿${script}`, "utf8");
  }
  scriptFileCache.set(script, file);
  return file;
}

export async function runPowerShellJson<T>(
  script: string,
  args: unknown,
  timeoutMs = 30_000,
): Promise<T> {
  const scriptFile = resolveScriptFile(script);
  return await new Promise<T>((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptFile],
      {
        env: { ...process.env, OPENCLAW_DESKTOP_ARGS: JSON.stringify(args ?? {}) },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        child.kill();
      } catch {
        // already exited
      }
      reject(new Error(`desktop: PowerShell timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1] ?? "";
      try {
        resolve(JSON.parse(last) as T);
      } catch {
        const detail = (stderr || stdout).trim().slice(0, 600);
        reject(new Error(`desktop: PowerShell failed (exit ${code}): ${detail || "no output"}`));
      }
    });
  });
}
