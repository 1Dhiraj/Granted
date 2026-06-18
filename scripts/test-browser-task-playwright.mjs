#!/usr/bin/env node
/**
 * Playwright end-to-end test: verify that qwen2.5-coder:14b executes browser
 * tool calls (not renders JSON as a text block) in the OpenClaw chat UI.
 *
 * Prerequisites:
 *   - Gateway running on port 18789 (node dist/index.js gateway --port 18789)
 *   - Bridge UI on port 7071
 *   - Ollama running with qwen2.5-coder:14b loaded
 *
 * Run: node scripts/test-browser-task-playwright.mjs
 */

import { chromium } from "playwright";

const BRIDGE_URL = "http://127.0.0.1:7071";
const GATEWAY_TOKEN = "123bd3ebe4c0269ca12c23488a40019d4f2066f6def01195";
const TOKENIZED_URL = `${BRIDGE_URL}/#token=${GATEWAY_TOKEN}`;
const PROMPT = "Open google.com and type 'weather' in the search box. Don't press enter. Follow the required workflow steps.";

// How long to wait for the AI to start responding (streaming can be slow)
const AI_RESPONSE_TIMEOUT = 120_000;

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const browser = await chromium.launch({ headless: false, slowMo: 100 });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Capture console messages for debugging
  const consoleLogs = [];
  page.on("console", (msg) => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));
  page.on("pageerror", (err) => consoleLogs.push(`[pageerror] ${err.message}`));

  console.log("Step 1: Opening OpenClaw bridge UI with auto-connect token…");
  await page.goto(TOKENIZED_URL, { waitUntil: "networkidle" });
  await page.screenshot({ path: "scripts/playwright-step1-opened.png" });

  // The hash token should auto-connect. Wait for the connected state.
  console.log("Step 2: Waiting for gateway connection…");
  try {
    // Wait until the Connect button is gone or a connected indicator appears.
    // The UI transitions from the connect form to the main nav after connecting.
    await page.waitForSelector('a[href="/chat"], a[href*="chat"]', { timeout: 15_000 });
    console.log("  [OK] Detected chat nav link — UI is connected.");
  } catch {
    // Fallback: try clicking Connect if the form is still visible
    const connectBtn = page.locator('button:has-text("Connect")');
    if (await connectBtn.isVisible()) {
      console.log("  Auto-connect did not fire; filling form manually…");
      // Ensure the WebSocket URL field points to the gateway
      const wsInput = page.locator('input[placeholder*="ws://"]').first();
      if (await wsInput.isVisible()) {
        await wsInput.fill(`ws://127.0.0.1:18789`);
      }
      const tokenInput = page.locator('input[placeholder*="token" i]').first();
      if (await tokenInput.isVisible()) {
        await tokenInput.fill(GATEWAY_TOKEN);
      }
      await connectBtn.click();
      await page.waitForSelector('a[href="/chat"], a[href*="chat"]', { timeout: 15_000 });
    } else {
      throw new Error("Cannot detect connected state — unknown UI.");
    }
  }
  await page.screenshot({ path: "scripts/playwright-step2-connected.png" });

  // Navigate to the Chat section
  console.log("Step 3: Navigating to Chat…");
  const chatLink = page.locator('a[href="/chat"]').first();
  if (await chatLink.isVisible()) {
    await chatLink.click();
  } else {
    await page.goto(`${BRIDGE_URL}/chat`, { waitUntil: "networkidle" });
  }
  await sleep(1000);
  await page.screenshot({ path: "scripts/playwright-step3-chat.png" });

  // Find the message input
  console.log("Step 4: Sending browser task prompt…");
  const chatInput = page.locator(
    'textarea, input[type="text"][placeholder*="message" i], [contenteditable="true"]',
  ).first();
  await chatInput.waitFor({ timeout: 10_000 });
  await chatInput.fill(PROMPT);
  await page.screenshot({ path: "scripts/playwright-step4-typed.png" });

  // Send the message (Enter or click Send button)
  await chatInput.press("Enter");
  console.log("  Prompt sent. Waiting for AI response…");

  // Capture any new message content
  await sleep(3000);
  await page.screenshot({ path: "scripts/playwright-step5-waiting.png" });

  // Wait for tool execution indicators — look for tool call UI elements
  // NOT for a JSON code block (which is the broken behavior)
  let toolExecuted = false;
  let jsonCodeBlockFound = false;
  const deadline = Date.now() + AI_RESPONSE_TIMEOUT;

  while (Date.now() < deadline) {
    await sleep(2000);
    const bodyText = await page.evaluate(() => document.body.innerText);

    // Bad: the AI dumped the JSON as a code block
    if (
      bodyText.includes('"action": "status"') ||
      bodyText.includes('"action":"status"') ||
      bodyText.includes("```json") ||
      bodyText.includes("```tool_call")
    ) {
      jsonCodeBlockFound = true;
      console.log("  [FAIL] Found JSON code block — AI is NOT executing tool calls.");
      break;
    }

    // Good: a tool execution event appeared
    // The UI renders tool calls as a "tool" or "function call" block, not raw JSON
    if (
      bodyText.includes("browser") &&
      (bodyText.includes("status") ||
        bodyText.includes("start") ||
        bodyText.includes("navigate") ||
        bodyText.includes("snapshot"))
    ) {
      // Check that it's a tool execution block (not text mentioning the word "status")
      const toolBlock = page.locator(
        '[class*="tool"], [class*="function-call"], [class*="ToolCall"], [data-tool]',
      );
      if ((await toolBlock.count()) > 0) {
        toolExecuted = true;
        console.log("  [PASS] Tool execution UI block detected.");
        break;
      }
    }

    // Also check for the agent being "typing" / running — means the tool IS being executed
    const isThinking = await page.evaluate(() => {
      const text = document.body.innerText;
      return (
        text.includes("Thinking") ||
        text.includes("Running") ||
        text.includes("Executing") ||
        text.includes("tool")
      );
    });
    if (isThinking) {
      console.log("  [INFO] AI is executing (thinking/running)…");
    }

    process.stdout.write(".");
  }
  console.log();

  await page.screenshot({ path: "scripts/playwright-step6-result.png" });

  // Final page text for diagnosis
  const finalText = await page.evaluate(() => document.body.innerText);
  const relevantLines = finalText
    .split("\n")
    .filter((l) => l.trim())
    .slice(-40)
    .join("\n");
  console.log("\n--- Final page content (last 40 lines) ---");
  console.log(relevantLines);
  console.log("---");

  if (consoleLogs.length > 0) {
    console.log("\n--- Console logs (last 10) ---");
    consoleLogs.slice(-10).forEach((l) => console.log(l));
  }

  await browser.close();

  // Result
  if (toolExecuted) {
    console.log("\n[PASS] Browser task is being executed via tool calls — fix is working!");
    process.exit(0);
  } else if (jsonCodeBlockFound) {
    console.log("\n[FAIL] AI is showing JSON as text — streaming buffer fix did not take effect.");
    process.exit(1);
  } else {
    console.log(
      "\n[INCONCLUSIVE] Could not definitively detect tool execution or JSON block.",
      "\nCheck the screenshots in scripts/playwright-step*.png for visual inspection.",
    );
    process.exit(2);
  }
}

main().catch((err) => {
  console.error("Playwright test error:", err);
  process.exit(1);
});
