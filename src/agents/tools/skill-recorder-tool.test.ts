import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFixtureSuite } from "../../test-utils/fixture-suite.js";
import { withEnv } from "../../test-utils/env.js";
import { buildWorkspaceSkillSnapshot } from "../skills.js";
import { createSkillRecorderTool } from "./skill-recorder-tool.js";

const fixtureSuite = createFixtureSuite("openclaw-skill-recorder-suite-");
let homeDir = "";
let workspaceDir = "";

beforeAll(async () => {
  await fixtureSuite.setup();
  homeDir = await fixtureSuite.createCaseDir("home");
  workspaceDir = path.join(homeDir, ".openclaw", "workspace");
  fs.mkdirSync(workspaceDir, { recursive: true });
});

afterAll(async () => {
  await fixtureSuite.cleanup();
});

function runTool(args: Record<string, unknown>) {
  // Point workspace resolution at the fixture home so the tool writes there.
  return withEnv(
    { HOME: homeDir, USERPROFILE: homeDir, OPENCLAW_CONFIG_PATH: undefined },
    async () => {
      const tool = createSkillRecorderTool({ agentSessionKey: "agent:main:main" });
      const result = (await tool.execute?.("test-call", args)) as {
        content?: Array<{ text?: string }>;
      };
      const text = result?.content?.[0]?.text ?? "{}";
      return JSON.parse(text) as Record<string, unknown>;
    },
  );
}

describe("skill_recorder record -> replay loop", () => {
  it("saves a parameterized skill with clean frontmatter", async () => {
    const saved = await runTool({
      action: "save",
      name: "File Expense",
      description: "File a monthly expense report\nwith a receipt attachment.",
      body: "## Inputs\n- {{month}}: the month\n\n## Steps\n1. Open portal\n\n## Verify\nConfirmation visible.",
    });
    expect(saved.status).toBe("ok");
    expect(saved.saved).toBe("file-expense");

    const skillFile = path.join(workspaceDir, "skills", "file-expense", "SKILL.md");
    const raw = fs.readFileSync(skillFile, "utf8");
    // Frontmatter description must be single-line for the loader.
    expect(raw).toContain("description: File a monthly expense report with a receipt attachment.");
    expect(raw).toContain("{{month}}");
  });

  it("lists and deletes saved skills", async () => {
    const listed = await runTool({ action: "list" });
    expect(listed.status).toBe("ok");
    const names = (listed.skills as Array<{ name: string }>).map((s) => s.name);
    expect(names).toContain("file-expense");

    const deleted = await runTool({ action: "delete", name: "File Expense" });
    expect(deleted.status).toBe("ok");
    const relisted = await runTool({ action: "list" });
    expect((relisted.skills as Array<{ name: string }>).map((s) => s.name)).not.toContain(
      "file-expense",
    );
  });

  it("rejects save without a body", async () => {
    const res = await runTool({ action: "save", name: "Broken", description: "no body" });
    expect(res.status).toBe("error");
  });

  it("closes the loop: a recorded skill appears in the workspace skill snapshot", async () => {
    const saved = await runTool({
      action: "save",
      name: "Deploy Docs Site",
      description: "Use when asked to deploy the documentation website.",
      body: "## Inputs\n- {{branch}}\n\n## Steps\n1. Run deploy {{branch}}\n\n## Verify\nSite responds 200.",
    });
    expect(saved.status).toBe("ok");

    const snapshot = withEnv({ HOME: homeDir, USERPROFILE: homeDir, PATH: "" }, () =>
      buildWorkspaceSkillSnapshot(workspaceDir, {
        managedSkillsDir: path.join(workspaceDir, ".managed"),
        bundledSkillsDir: path.join(workspaceDir, ".bundled"),
      }),
    );
    const entry = snapshot.skills.find((s) => s.name === "deploy-docs-site");
    expect(entry).toBeDefined();
    // The prompt is what the model actually sees — the replay half of the loop.
    expect(snapshot.prompt).toContain("deploy-docs-site");
    expect(snapshot.prompt).toContain("deploy the documentation website");
  });
});
