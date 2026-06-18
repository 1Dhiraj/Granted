/**
 * Cross-platform Node.js equivalent of scripts/bundle-a2ui.sh.
 * Bundles the A2UI canvas renderer using rolldown, skipping gracefully when
 * source directories are absent (sparse checkouts, Docker builds, etc.).
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { promises as fsp } from "node:fs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");

const HASH_FILE = path.join(ROOT_DIR, "src/canvas-host/a2ui/.bundle.hash");
const OUTPUT_FILE = path.join(ROOT_DIR, "src/canvas-host/a2ui/a2ui.bundle.js");
const A2UI_RENDERER_DIR = path.join(ROOT_DIR, "vendor/a2ui/renderers/lit");
const A2UI_APP_DIR = path.join(ROOT_DIR, "apps/shared/OpenClawKit/Tools/CanvasA2UI");

function directoryExists(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function fileExists(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Hash computation — mirrors the bash script's compute_hash logic
// ---------------------------------------------------------------------------

async function walkFiles(entryPath, results = []) {
  const st = await fsp.stat(entryPath);
  if (st.isDirectory()) {
    const entries = await fsp.readdir(entryPath);
    for (const entry of entries) {
      await walkFiles(path.join(entryPath, entry), results);
    }
  } else {
    results.push(entryPath);
  }
  return results;
}

async function computeHash(inputPaths) {
  const files = [];
  for (const inputPath of inputPaths) {
    await walkFiles(inputPath, files);
  }

  const normalize = (p) => p.split(path.sep).join("/");
  files.sort((a, b) => normalize(a).localeCompare(normalize(b)));

  const hash = createHash("sha256");
  for (const filePath of files) {
    const rel = normalize(path.relative(ROOT_DIR, filePath));
    hash.update(rel);
    hash.update("\0");
    hash.update(await fsp.readFile(filePath));
    hash.update("\0");
  }
  return hash.digest("hex");
}

// ---------------------------------------------------------------------------
// Rolldown resolution — matches the bash script's fallback chain
// ---------------------------------------------------------------------------

function findRolldownBin() {
  const candidates = [
    path.join(ROOT_DIR, "node_modules/.pnpm/node_modules/rolldown/bin/cli.mjs"),
    path.join(ROOT_DIR, "node_modules/.pnpm/rolldown@1.0.0-rc.9/node_modules/rolldown/bin/cli.mjs"),
    path.join(ROOT_DIR, "node_modules/rolldown/bin/cli.mjs"),
  ];
  for (const candidate of candidates) {
    if (fileExists(candidate)) return candidate;
  }
  return null;
}

function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: "inherit", ...opts });
}

function runNode(script, args = [], opts = {}) {
  run(process.execPath, [script, ...args], opts);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Gracefully skip when source directories are absent.
  if (!directoryExists(A2UI_RENDERER_DIR) || !directoryExists(A2UI_APP_DIR)) {
    if (fileExists(OUTPUT_FILE)) {
      console.log("A2UI sources missing; keeping prebuilt bundle.");
      return;
    }
    if (process.env.OPENCLAW_A2UI_SKIP_MISSING === "1" || process.env.OPENCLAW_SPARSE_PROFILE) {
      console.error(
        "A2UI sources missing; skipping bundle because OPENCLAW_A2UI_SKIP_MISSING=1 or OPENCLAW_SPARSE_PROFILE is set.",
      );
      return;
    }
    console.error(`A2UI sources missing and no prebuilt bundle found at: ${OUTPUT_FILE}`);
    process.exit(1);
  }

  const inputPaths = [
    path.join(ROOT_DIR, "package.json"),
    path.join(ROOT_DIR, "pnpm-lock.yaml"),
    A2UI_RENDERER_DIR,
    A2UI_APP_DIR,
  ];

  const currentHash = await computeHash(inputPaths);

  if (fileExists(HASH_FILE)) {
    const previousHash = fs.readFileSync(HASH_FILE, "utf8").trim();
    if (previousHash === currentHash && fileExists(OUTPUT_FILE)) {
      console.log("A2UI bundle up to date; skipping.");
      return;
    }
  }

  // Run TypeScript compile for the renderer.
  const tsconfigPath = path.join(A2UI_RENDERER_DIR, "tsconfig.json");
  run("pnpm", ["-s", "exec", "tsc", "-p", tsconfigPath], { shell: process.platform === "win32" });

  // Run rolldown bundler.
  const rolldownConfig = path.join(A2UI_APP_DIR, "rolldown.config.mjs");
  const rolldownBin = findRolldownBin();
  if (rolldownBin) {
    runNode(rolldownBin, ["-c", rolldownConfig]);
  } else {
    run("pnpm", ["-s", "dlx", "rolldown", "-c", rolldownConfig], {
      shell: process.platform === "win32",
    });
  }

  // Write the new hash so future runs can skip.
  fs.mkdirSync(path.dirname(HASH_FILE), { recursive: true });
  fs.writeFileSync(HASH_FILE, currentHash, "utf8");
}

main().catch((err) => {
  console.error("A2UI bundling failed. Re-run with: pnpm canvas:a2ui:bundle");
  console.error("If this persists, verify pnpm deps and try again.");
  console.error(err);
  process.exit(1);
});
