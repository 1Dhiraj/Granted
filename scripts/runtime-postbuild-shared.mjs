import fs from "node:fs";
import path, { dirname } from "node:path";

export function writeTextFileIfChanged(filePath, contents) {
  const next = String(contents);
  try {
    const current = fs.readFileSync(filePath, "utf8");
    if (current === next) {
      return false;
    }
  } catch {
    // Write the file when it does not exist or cannot be read.
  }
  fs.mkdirSync(dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, next, "utf8");
  return true;
}

export function removeFileIfExists(filePath) {
  try {
    fs.rmSync(filePath, { force: true });
    return true;
  } catch {
    return false;
  }
}

// On Windows, fs.rmSync({ recursive: true }) can fail when directories contain
// junction points because it tries to recurse into them rather than unlinking
// them as leaf nodes. This helper walks the tree manually on Windows, unlinking
// any symlinks/junctions before the recursive delete so rmSync never sees them.
function removeWindowsPath(filePath) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch {
    return; // already gone
  }

  // Symlinks and junction points: unlink without following the target.
  if (stat.isSymbolicLink()) {
    try {
      fs.rmSync(filePath);
    } catch {
      // ignore
    }
    return;
  }

  if (stat.isDirectory()) {
    let entries;
    try {
      entries = fs.readdirSync(filePath, { withFileTypes: true });
    } catch {
      entries = [];
    }
    for (const entry of entries) {
      removeWindowsPath(path.join(filePath, entry.name));
    }
    try {
      fs.rmdirSync(filePath);
    } catch {
      // ignore — may still have stale lock handles
    }
    return;
  }

  // Regular file.
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    // ignore
  }
}

export function removePathIfExists(filePath) {
  try {
    if (process.platform === "win32") {
      removeWindowsPath(filePath);
      return true;
    }
    fs.rmSync(filePath, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}
