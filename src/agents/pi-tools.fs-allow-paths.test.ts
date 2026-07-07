import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@mariozechner/pi-ai", async () => {
  const original =
    await vi.importActual<typeof import("@mariozechner/pi-ai")>("@mariozechner/pi-ai");
  return {
    ...original,
  };
});

vi.mock("@mariozechner/pi-ai/oauth", async () => {
  const actual = await vi.importActual<typeof import("@mariozechner/pi-ai/oauth")>(
    "@mariozechner/pi-ai/oauth",
  );
  return {
    ...actual,
    getOAuthApiKey: () => undefined,
    getOAuthProviders: () => [],
  };
});

import { createOpenClawCodingTools } from "./pi-tools.js";
import { normalizeFsAllowPaths, resolveToolFsConfig } from "./tool-fs-policy.js";

describe("FS tools with workspaceOnly=true and allowPaths", () => {
  let tmpDir: string;
  let workspaceDir: string;
  let grantedDir: string;
  let forbiddenFile: string;

  const hasToolError = (result: { content: Array<{ type: string; text?: string }> }) =>
    result.content.some((content) => {
      if (content.type !== "text") {
        return false;
      }
      return content.text?.toLowerCase().includes("error") ?? false;
    });

  const tools = () =>
    createOpenClawCodingTools({
      workspaceDir,
      config: {
        tools: {
          fs: {
            workspaceOnly: true,
            allowPaths: [grantedDir],
          },
        },
      },
    });

  const toolByName = (name: "write" | "edit" | "read") => {
    const tool = tools().find((candidate) => candidate.name === name);
    expect(tool).toBeDefined();
    return tool!;
  };

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-allowpaths-"));
    workspaceDir = path.join(tmpDir, "workspace");
    grantedDir = path.join(tmpDir, "granted");
    await fs.mkdir(workspaceDir);
    await fs.mkdir(grantedDir);
    forbiddenFile = path.join(tmpDir, "forbidden.txt");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("allows write inside the workspace", async () => {
    const target = path.join(workspaceDir, "inside.txt");
    const result = await toolByName("write").execute("ap-1", {
      path: target,
      content: "workspace content",
    });
    expect(hasToolError(result)).toBe(false);
    await expect(fs.readFile(target, "utf-8")).resolves.toBe("workspace content");
  });

  it("allows write inside a granted allowPaths directory", async () => {
    const target = path.join(grantedDir, "notes", "granted.txt");
    const result = await toolByName("write").execute("ap-2", {
      path: target,
      content: "granted content",
    });
    expect(hasToolError(result)).toBe(false);
    await expect(fs.readFile(target, "utf-8")).resolves.toBe("granted content");
  });

  it("allows read inside a granted allowPaths directory", async () => {
    const target = path.join(grantedDir, "readable.txt");
    await fs.writeFile(target, "readable content");
    const result = await toolByName("read").execute("ap-3", { path: target });
    expect(hasToolError(result)).toBe(false);
  });

  it("allows edit inside a granted allowPaths directory", async () => {
    const target = path.join(grantedDir, "editable.txt");
    await fs.writeFile(target, "before edit");
    const result = await toolByName("edit").execute("ap-4", {
      path: target,
      edits: [{ oldText: "before edit", newText: "after edit" }],
    });
    expect(hasToolError(result)).toBe(false);
    await expect(fs.readFile(target, "utf-8")).resolves.toBe("after edit");
  });

  it("blocks write outside the workspace and granted directories", async () => {
    await expect(
      toolByName("write").execute("ap-5", {
        path: forbiddenFile,
        content: "should not be written",
      }),
    ).rejects.toThrow(/Path escapes (workspace|sandbox) root/);
    await expect(fs.access(forbiddenFile)).rejects.toThrow();
  });

  it("blocks read outside the workspace and granted directories", async () => {
    await fs.writeFile(forbiddenFile, "secret");
    await expect(toolByName("read").execute("ap-6", { path: forbiddenFile })).rejects.toThrow(
      /Path escapes (workspace|sandbox) root/,
    );
  });

  it("allows relative paths that resolve into a granted directory", async () => {
    const target = path.join(grantedDir, "via-relative.txt");
    const relative = path.join("..", "granted", "via-relative.txt");
    const result = await toolByName("write").execute("ap-7", {
      path: relative,
      content: "relative into granted",
    });
    expect(hasToolError(result)).toBe(false);
    await expect(fs.readFile(target, "utf-8")).resolves.toBe("relative into granted");
  });
});

describe("normalizeFsAllowPaths", () => {
  it("expands ~ to the home directory", () => {
    expect(normalizeFsAllowPaths(["~"])).toEqual([path.resolve(os.homedir())]);
    expect(normalizeFsAllowPaths(["~/projects"])).toEqual([
      path.resolve(path.join(os.homedir(), "projects")),
    ]);
  });

  it("drops relative and empty entries", () => {
    expect(normalizeFsAllowPaths(["relative/dir", "", "   "])).toEqual([]);
  });

  it("keeps absolute entries resolved", () => {
    const absolute = path.join(os.tmpdir(), "granted");
    expect(normalizeFsAllowPaths([absolute])).toEqual([path.resolve(absolute)]);
  });
});

describe("resolveToolFsConfig allowPaths merge", () => {
  it("merges global and agent allowPaths", () => {
    const cfg = {
      tools: { fs: { workspaceOnly: true, allowPaths: ["/global/dir"] } },
      agents: {
        list: [{ id: "main", tools: { fs: { allowPaths: ["/agent/dir"] } } }],
      },
    } as never;
    const resolved = resolveToolFsConfig({ cfg, agentId: "main" });
    expect(resolved.workspaceOnly).toBe(true);
    expect(resolved.allowPaths).toEqual(["/global/dir", "/agent/dir"]);
  });

  it("returns undefined allowPaths when none configured", () => {
    const cfg = { tools: { fs: { workspaceOnly: true } } } as never;
    expect(resolveToolFsConfig({ cfg }).allowPaths).toBeUndefined();
  });
});
