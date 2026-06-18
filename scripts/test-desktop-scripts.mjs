// Standalone smoke test for the desktop extension's PowerShell scripts.
// Usage: pnpm exec tsx scripts/test-desktop-scripts.mjs [status|apps|snapshot|launch|type|key|click|screenshot]
import { runPowerShellJson } from "../extensions/desktop/src/powershell.ts";
import {
  APPS_SCRIPT,
  CLICK_SCRIPT,
  CLIPBOARD_SCRIPT,
  DRAG_SCRIPT,
  FIND_SCRIPT,
  FOCUS_SCRIPT,
  KEY_SCRIPT,
  LAUNCH_SCRIPT,
  PASTE_SCRIPT,
  PATTERN_SCRIPT,
  READ_SCRIPT,
  SCREENSHOT_SCRIPT,
  SNAPSHOT_SCRIPT,
  STATUS_SCRIPT,
  TYPE_SCRIPT,
  WAIT_SCRIPT,
  WINDOW_SCRIPT,
} from "../extensions/desktop/src/scripts.ts";

const mode = process.argv[2] ?? "status";

async function main() {
  switch (mode) {
    case "status":
      console.log(JSON.stringify(await runPowerShellJson(STATUS_SCRIPT, {}, 30000), null, 2));
      break;
    case "apps":
      console.log(JSON.stringify(await runPowerShellJson(APPS_SCRIPT, {}, 30000), null, 2));
      break;
    case "snapshot": {
      const title = process.argv[3] || undefined;
      const r = await runPowerShellJson(
        SNAPSHOT_SCRIPT,
        { title, maxElements: 100, maxDepth: 12 },
        60000,
      );
      console.log(JSON.stringify(r, null, 2).slice(0, 4000));
      break;
    }
    case "focus":
      console.log(
        JSON.stringify(
          await runPowerShellJson(FOCUS_SCRIPT, { title: process.argv[3] || "Notepad" }, 30000),
          null,
          2,
        ),
      );
      break;
    case "focustype": {
      // focus a window, type into it, then snapshot to verify — one process chain
      const title = process.argv[3] || "Notepad";
      const text = process.argv[4] || "Hello from OpenClaw desktop automation!";
      console.log(JSON.stringify(await runPowerShellJson(FOCUS_SCRIPT, { title }, 30000)));
      console.log(JSON.stringify(await runPowerShellJson(TYPE_SCRIPT, { text }, 60000)));
      const snap = await runPowerShellJson(
        SNAPSHOT_SCRIPT,
        { title, maxElements: 40, maxDepth: 12 },
        60000,
      );
      const doc = (snap.elements ?? []).find((e) => e.role === "Document" || e.role === "Edit");
      console.log("document value:", JSON.stringify(doc?.value ?? null));
      break;
    }
    case "clear": {
      // focus, ctrl+a, delete — verify document empties
      const title = process.argv[3] || "Notepad";
      console.log(JSON.stringify(await runPowerShellJson(FOCUS_SCRIPT, { title }, 30000)));
      console.log(
        JSON.stringify(
          await runPowerShellJson(KEY_SCRIPT, { modifiers: [17], key: 65, label: "ctrl+a" }, 30000),
        ),
      );
      console.log(
        JSON.stringify(
          await runPowerShellJson(KEY_SCRIPT, { modifiers: [], key: 46, label: "delete" }, 30000),
        ),
      );
      const snap = await runPowerShellJson(
        SNAPSHOT_SCRIPT,
        { title, maxElements: 40, maxDepth: 12 },
        60000,
      );
      const doc = (snap.elements ?? []).find((e) => e.role === "Document" || e.role === "Edit");
      console.log("document value after clear:", JSON.stringify(doc?.value ?? null));
      break;
    }
    case "clicktype": {
      // focus, click at coords, type — all in one harness run so no console
      // activation happens in between; verifies click places the caret
      const title = process.argv[3] || "Notepad";
      const x = Number(process.argv[4] ?? 844);
      const y = Number(process.argv[5] ?? 514);
      console.log(JSON.stringify(await runPowerShellJson(FOCUS_SCRIPT, { title }, 30000)));
      console.log(
        JSON.stringify(
          await runPowerShellJson(CLICK_SCRIPT, { x, y, button: "left", double: false }, 30000),
        ),
      );
      console.log(
        JSON.stringify(await runPowerShellJson(TYPE_SCRIPT, { text: "CLICK-OK " }, 30000)),
      );
      const snap = await runPowerShellJson(
        SNAPSHOT_SCRIPT,
        { title, maxElements: 40, maxDepth: 12 },
        60000,
      );
      const doc = (snap.elements ?? []).find((e) => e.role === "Document" || e.role === "Edit");
      console.log("document value:", JSON.stringify(doc?.value ?? null));
      break;
    }
    case "fullflow": {
      // The real agent flow: focus → snapshot → click Document ref → type → verify
      const title = process.argv[3] || "Notepad";
      console.log(JSON.stringify(await runPowerShellJson(FOCUS_SCRIPT, { title }, 30000)));
      const snap1 = await runPowerShellJson(
        SNAPSHOT_SCRIPT,
        { title, maxElements: 60, maxDepth: 12 },
        60000,
      );
      const doc1 = (snap1.elements ?? []).find((e) => e.role === "Document" || e.role === "Edit");
      if (!doc1) {
        throw new Error("no Document element in snapshot");
      }
      console.log("document at:", doc1.x, doc1.y, "value:", JSON.stringify(doc1.value));
      console.log(
        JSON.stringify(
          await runPowerShellJson(
            CLICK_SCRIPT,
            { x: doc1.x, y: doc1.y, button: "left", double: false },
            30000,
          ),
        ),
      );
      console.log(
        JSON.stringify(await runPowerShellJson(TYPE_SCRIPT, { text: "FULLFLOW-OK " }, 30000)),
      );
      const snap2 = await runPowerShellJson(
        SNAPSHOT_SCRIPT,
        { title, maxElements: 60, maxDepth: 12 },
        60000,
      );
      const doc2 = (snap2.elements ?? []).find((e) => e.role === "Document" || e.role === "Edit");
      console.log("document value after:", JSON.stringify(doc2?.value ?? null));
      break;
    }
    case "diag": {
      // foreground tracking around click+type to find where input goes
      const title = process.argv[3] || "Notepad";
      const fg = async () =>
        (await runPowerShellJson(STATUS_SCRIPT, {}, 30000)).foreground;
      console.log("fg0:", JSON.stringify(await fg()));
      console.log("focus:", JSON.stringify(await runPowerShellJson(FOCUS_SCRIPT, { title }, 30000)));
      console.log("fg1 (after focus):", JSON.stringify(await fg()));
      const snap = await runPowerShellJson(
        SNAPSHOT_SCRIPT,
        { title, maxElements: 60, maxDepth: 12 },
        60000,
      );
      const doc = (snap.elements ?? []).find((e) => e.role === "Document" || e.role === "Edit");
      console.log("doc:", JSON.stringify(doc));
      console.log(
        "click:",
        JSON.stringify(
          await runPowerShellJson(
            CLICK_SCRIPT,
            { x: doc.x, y: doc.y, button: "left", double: false },
            30000,
          ),
        ),
      );
      console.log("fg2 (after click):", JSON.stringify(await fg()));
      console.log(
        "type:",
        JSON.stringify(await runPowerShellJson(TYPE_SCRIPT, { text: "DIAG-1 " }, 30000)),
      );
      console.log("fg3 (after type):", JSON.stringify(await fg()));
      break;
    }
    case "launch":
      console.log(
        JSON.stringify(
          await runPowerShellJson(LAUNCH_SCRIPT, { app: process.argv[3] || "notepad" }, 30000),
          null,
          2,
        ),
      );
      break;
    case "type":
      console.log(
        JSON.stringify(
          await runPowerShellJson(TYPE_SCRIPT, { text: process.argv[3] || "hello" }, 30000),
          null,
          2,
        ),
      );
      break;
    case "key": {
      const vk = Number(process.argv[3] ?? 35);
      console.log(
        JSON.stringify(
          await runPowerShellJson(KEY_SCRIPT, { modifiers: [], key: vk, label: `vk${vk}` }, 30000),
          null,
          2,
        ),
      );
      break;
    }
    case "click":
      console.log(
        JSON.stringify(
          await runPowerShellJson(
            CLICK_SCRIPT,
            { x: Number(process.argv[3] ?? 500), y: Number(process.argv[4] ?? 500), button: "left", double: false },
            30000,
          ),
          null,
          2,
        ),
      );
      break;
    case "screenshot": {
      const path = `${process.env.TEMP}\\desktop-test-${Date.now()}.png`;
      console.log(
        JSON.stringify(await runPowerShellJson(SCREENSHOT_SCRIPT, { path }, 30000), null, 2),
      );
      break;
    }
    case "clipboard": {
      const text = process.argv[3] || "clipboard-roundtrip-test";
      console.log(
        "set:",
        JSON.stringify(await runPowerShellJson(CLIPBOARD_SCRIPT, { op: "set", text }, 30000)),
      );
      console.log(
        "get:",
        JSON.stringify(await runPowerShellJson(CLIPBOARD_SCRIPT, { op: "get" }, 30000)),
      );
      break;
    }
    case "paste": {
      // focus notepad, click editor, paste multi-line text, verify via snapshot
      const title = process.argv[3] || "Notepad";
      const text = "PASTE-LINE-1 with special chars: éñ漢字 $#@!\nPASTE-LINE-2 done.";
      console.log(JSON.stringify(await runPowerShellJson(FOCUS_SCRIPT, { title }, 30000)));
      const snap = await runPowerShellJson(
        SNAPSHOT_SCRIPT,
        { title, maxElements: 40, maxDepth: 12 },
        60000,
      );
      const doc = (snap.elements ?? []).find((e) => e.role === "Document" || e.role === "Edit");
      console.log(
        JSON.stringify(
          await runPowerShellJson(
            CLICK_SCRIPT,
            { x: doc.x, y: doc.y, button: "left", double: false },
            30000,
          ),
        ),
      );
      console.log("paste:", JSON.stringify(await runPowerShellJson(PASTE_SCRIPT, { text }, 30000)));
      const r = await runPowerShellJson(READ_SCRIPT, { x: doc.x, y: doc.y, maxChars: 500 }, 30000);
      console.log("read-back:", JSON.stringify(r));
      break;
    }
    case "read": {
      const title = process.argv[3] || "Notepad";
      const snap = await runPowerShellJson(
        SNAPSHOT_SCRIPT,
        { title, maxElements: 40, maxDepth: 12 },
        60000,
      );
      const doc = (snap.elements ?? []).find((e) => e.role === "Document" || e.role === "Edit");
      console.log("element at:", doc?.x, doc?.y);
      console.log(
        JSON.stringify(
          await runPowerShellJson(READ_SCRIPT, { x: doc.x, y: doc.y, maxChars: 300 }, 30000),
          null,
          2,
        ),
      );
      break;
    }
    case "window": {
      const title = process.argv[3] || "Notepad";
      const op = process.argv[4] || "maximize";
      console.log(
        JSON.stringify(await runPowerShellJson(WINDOW_SCRIPT, { title, op }, 30000), null, 2),
      );
      break;
    }
    case "wait": {
      const title = process.argv[3] || "Notepad";
      const name = process.argv[4] || undefined;
      console.log(
        JSON.stringify(
          await runPowerShellJson(WAIT_SCRIPT, { title, name, timeoutMs: 8000 }, 30000),
          null,
          2,
        ),
      );
      break;
    }
    case "find": {
      const title = process.argv[3] || "Notepad";
      const name = process.argv[4] || "File";
      const r = await runPowerShellJson(FIND_SCRIPT, { title, name, maxResults: 10 }, 60000);
      console.log(JSON.stringify(r, null, 2).slice(0, 3000));
      break;
    }
    case "pattern": {
      // toggle/invoke on an element found by name
      const title = process.argv[3] || "Notepad";
      const name = process.argv[4] || "Settings";
      const op = process.argv[5] || "invoke";
      const found = await runPowerShellJson(FIND_SCRIPT, { title, name, maxResults: 3 }, 60000);
      const el = (found.elements ?? [])[0];
      if (!el) {
        throw new Error("no element found to apply pattern");
      }
      console.log("target:", JSON.stringify(el));
      console.log(
        JSON.stringify(await runPowerShellJson(PATTERN_SCRIPT, { x: el.x, y: el.y, op }, 30000)),
      );
      break;
    }
    case "drag": {
      const x = Number(process.argv[3] ?? 600);
      const y = Number(process.argv[4] ?? 400);
      const toX = Number(process.argv[5] ?? 800);
      const toY = Number(process.argv[6] ?? 500);
      console.log(
        JSON.stringify(await runPowerShellJson(DRAG_SCRIPT, { x, y, toX, toY }, 30000), null, 2),
      );
      break;
    }
    default:
      throw new Error(`unknown mode ${mode}`);
  }
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
