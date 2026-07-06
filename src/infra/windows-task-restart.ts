import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { quoteCmdScriptArg } from "../daemon/cmd-argv.js";
import { resolveGatewayWindowsTaskName } from "../daemon/constants.js";
import { resolveTaskScriptPath } from "../daemon/schtasks.js";
import { formatErrorMessage } from "./errors.js";
import type { RestartAttempt } from "./restart.js";
import { resolvePreferredOpenClawTmpDir } from "./tmp-openclaw-dir.js";

const TASK_RESTART_RETRY_LIMIT = 30;
// Delay via ping: `timeout /t` exits immediately with an error when stdin is
// redirected (this helper runs detached with stdio ignored), which used to burn
// every retry within milliseconds — while the old task instance was still
// alive, so MultipleInstancesPolicy=IgnoreNew silently swallowed each /Run and
// the gateway never came back. `ping -n 3` ≈ 2s and needs no console.
const TASK_RESTART_DELAY_CMD = "ping -n 3 127.0.0.1 >nul 2>&1";
const DEFAULT_GATEWAY_PORT = 18789;

function resolveWindowsTaskName(env: NodeJS.ProcessEnv): string {
  const override = env.OPENCLAW_WINDOWS_TASK_NAME?.trim();
  if (override) {
    return override;
  }
  return resolveGatewayWindowsTaskName(env.OPENCLAW_PROFILE);
}

function resolveGatewayPort(env: NodeJS.ProcessEnv): number {
  const raw = env.OPENCLAW_GATEWAY_PORT?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535
    ? parsed
    : DEFAULT_GATEWAY_PORT;
}

function buildScheduledTaskRestartScript(
  taskName: string,
  gatewayPort: number,
  taskScriptPath?: string,
): string {
  const quotedTaskName = quoteCmdScriptArg(taskName);
  // Success = the gateway is actually listening again. `schtasks /Run` exits 0
  // even when IgnoreNew discards the request (old instance still finishing), so
  // its exit code cannot be trusted; keep re-running until the port is bound.
  const portListeningCheck = `netstat -an | findstr "LISTENING" | findstr /C:":${gatewayPort} " >nul 2>&1`;
  const lines = [
    "@echo off",
    "setlocal",
    `schtasks /Query /TN ${quotedTaskName} >nul 2>&1`,
    "if errorlevel 1 goto fallback",
    "set /a attempts=0",
    ":retry",
    TASK_RESTART_DELAY_CMD,
    "set /a attempts+=1",
    portListeningCheck,
    "if not errorlevel 1 goto cleanup",
    `schtasks /Run /TN ${quotedTaskName} >nul 2>&1`,
    `if %attempts% GEQ ${TASK_RESTART_RETRY_LIMIT} goto fallback`,
    "goto retry",
    ":fallback",
    portListeningCheck,
    "if not errorlevel 1 goto cleanup",
  ];
  if (taskScriptPath) {
    const quotedScript = quoteCmdScriptArg(taskScriptPath);
    lines.push(`if exist ${quotedScript} (`, `  start "" /min cmd.exe /d /c ${quotedScript}`, ")");
  }
  lines.push(":cleanup", 'del "%~f0" >nul 2>&1');
  return lines.join("\r\n");
}

export function relaunchGatewayScheduledTask(env: NodeJS.ProcessEnv = process.env): RestartAttempt {
  const taskName = resolveWindowsTaskName(env);
  const taskScriptPath = resolveTaskScriptPath(env);
  const scriptPath = path.join(
    resolvePreferredOpenClawTmpDir(),
    `openclaw-schtasks-restart-${randomUUID()}.cmd`,
  );
  const quotedScriptPath = quoteCmdScriptArg(scriptPath);
  try {
    fs.writeFileSync(
      scriptPath,
      `${buildScheduledTaskRestartScript(taskName, resolveGatewayPort(env), taskScriptPath)}\r\n`,
      "utf8",
    );
    const child = spawn("cmd.exe", ["/d", "/s", "/c", quotedScriptPath], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    return {
      ok: true,
      method: "schtasks",
      tried: [`schtasks /Run /TN "${taskName}"`, `cmd.exe /d /s /c ${quotedScriptPath}`],
    };
  } catch (err) {
    try {
      fs.unlinkSync(scriptPath);
    } catch {
      // Best-effort cleanup; keep the original restart failure.
    }
    return {
      ok: false,
      method: "schtasks",
      detail: formatErrorMessage(err),
      tried: [`schtasks /Run /TN "${taskName}"`],
    };
  }
}
