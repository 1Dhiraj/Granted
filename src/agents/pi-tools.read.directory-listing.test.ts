import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createOpenClawReadTool } from "./pi-tools.read.js";
import type { AnyAgentTool } from "./pi-tools.types.js";

function createBaseReadTool() {
  const execute = vi.fn(async () => ({
    content: [{ type: "text", text: "file contents" }],
  }));
  const tool = {
    name: "read",
    description: "Read a file",
    inputSchema: { type: "object", properties: {} },
    execute,
  } as unknown as AnyAgentTool;
  return { execute, tool };
}

describe("createOpenClawReadTool directory listing", () => {
  let root: string;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "read-dir-test-"));
    await fs.mkdir(path.join(root, "jobs", "archive"), { recursive: true });
    await fs.writeFile(path.join(root, "jobs", "b-task.md"), "- [ ] step", "utf-8");
    await fs.writeFile(path.join(root, "jobs", "a-task.md"), "- [x] step", "utf-8");
    await fs.writeFile(path.join(root, "note.txt"), "hello", "utf-8");
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("returns a listing when the path is a directory (dirs first, sorted)", async () => {
    const { execute, tool } = createBaseReadTool();
    const wrapped = createOpenClawReadTool(tool, { workspaceRoot: root });

    const result = await wrapped.execute("tc1", { path: path.join(root, "jobs") });

    expect(execute).not.toHaveBeenCalled();
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("3 entries");
    const lines = text.split("\n").slice(1);
    expect(lines).toEqual(["archive/", "a-task.md", "b-task.md"]);
    expect(result.details).toMatchObject({ directory: true, entries: 3 });
  });

  it("resolves relative directory paths against the workspace root", async () => {
    const { execute, tool } = createBaseReadTool();
    const wrapped = createOpenClawReadTool(tool, { workspaceRoot: root });

    const result = await wrapped.execute("tc2", { path: "jobs" });

    expect(execute).not.toHaveBeenCalled();
    expect((result.content[0] as { text: string }).text).toContain("a-task.md");
  });

  it("reports empty directories", async () => {
    const { execute, tool } = createBaseReadTool();
    const wrapped = createOpenClawReadTool(tool, { workspaceRoot: root });

    const result = await wrapped.execute("tc3", { path: path.join(root, "jobs", "archive") });

    expect(execute).not.toHaveBeenCalled();
    expect((result.content[0] as { text: string }).text).toContain("is empty");
  });

  it("delegates to the base tool for regular files", async () => {
    const { execute, tool } = createBaseReadTool();
    const wrapped = createOpenClawReadTool(tool, { workspaceRoot: root });

    const result = await wrapped.execute("tc4", { path: path.join(root, "note.txt") });

    expect(execute).toHaveBeenCalledTimes(1);
    expect((result.content[0] as { text: string }).text).toBe("file contents");
  });

  it("delegates to the base tool for missing paths", async () => {
    const { execute, tool } = createBaseReadTool();
    const wrapped = createOpenClawReadTool(tool, { workspaceRoot: root });

    await wrapped.execute("tc5", { path: path.join(root, "does-not-exist.txt") });

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("keeps directory listing disabled without a workspaceRoot (sandbox callers)", async () => {
    const { execute, tool } = createBaseReadTool();
    const wrapped = createOpenClawReadTool(tool, {});

    await wrapped.execute("tc6", { path: path.join(root, "jobs") });

    expect(execute).toHaveBeenCalledTimes(1);
  });
});
