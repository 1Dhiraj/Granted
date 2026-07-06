import fs from "node:fs";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import { loadConfig } from "../../config/config.js";
import { resolveAgentIdFromSessionKey } from "../../routing/session-key.js";
import { resolveAgentWorkspaceDir } from "../agent-scope.js";
import { stringEnum } from "../schema/typebox.js";
import { type AnyAgentTool, jsonResult, readStringParam } from "./common.js";

// Record & Replay: turn a task the user just demonstrated (browser `record`) or
// that the agent just performed (its own action trace) into a reusable, editable
// SKILL.md. Saved skills live in <workspace>/skills/<name>/ and are auto-loaded
// by the skills system, so replay = the agent following the skill with new
// inputs. Distillation (writing parameterized steps) is done by the model; this
// tool persists/lists/removes the resulting skill files reliably.

const SKILL_RECORDER_ACTIONS = ["save", "list", "delete"] as const;

const SLUG_RE = /[^a-z0-9]+/g;

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(SLUG_RE, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export const SkillRecorderToolSchema = Type.Object(
  {
    action: stringEnum(SKILL_RECORDER_ACTIONS),
    name: Type.Optional(
      Type.String({
        description:
          "Skill name (turned into a kebab-case folder). Required for save and delete. e.g. \"File Expense\".",
      }),
    ),
    description: Type.Optional(
      Type.String({
        description:
          "WHEN to use this skill — becomes the frontmatter description / trigger. Required for save. Be specific so the agent knows when to reach for it.",
      }),
    ),
    body: Type.Optional(
      Type.String({
        description:
          "The full SKILL.md body (Markdown) for save. Include sections: '## Inputs' (each variable as {{placeholder}} with a note), '## Steps' (numbered, each an exact action — the browser/desktop action + target — parameterized with the {{placeholders}}), and '## Verify' (how to confirm success). This is the distilled, parameterized recording.",
      }),
    ),
  },
  { additionalProperties: false },
);

function resolveSkillsDir(agentSessionKey?: string): string {
  const cfg = loadConfig();
  const agentId = resolveAgentIdFromSessionKey(agentSessionKey);
  const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
  return path.join(workspaceDir, "skills");
}

export function createSkillRecorderTool(opts?: { agentSessionKey?: string }): AnyAgentTool {
  return {
    label: "Skill Recorder",
    name: "skill_recorder",
    ownerOnly: true,
    description: [
      "Record & Replay: save a demonstrated/performed task as a reusable, parameterized SKILL.md, or list/delete saved skills.",
      "Typical flow: (1) record the task — for the web use the browser tool's record action so the USER demonstrates, or just perform it yourself; (2) distill what happened into parameterized steps; (3) action=save with name + description (when to use) + body (Inputs/Steps/Verify, with {{placeholders}} for anything that varies); (4) later, replay by following the saved skill with new input values.",
      "Saved skills auto-load from the workspace, so once saved the agent can run them on request. To change what's parameterized, edit the skill's SKILL.md and save again.",
    ].join(" "),
    parameters: SkillRecorderToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      let skillsDir: string;
      try {
        skillsDir = resolveSkillsDir(opts?.agentSessionKey);
      } catch (err) {
        return jsonResult({
          status: "error",
          error: `Could not resolve workspace skills dir: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      if (action === "list") {
        try {
          if (!fs.existsSync(skillsDir)) {
            return jsonResult({ status: "ok", skills: [] });
          }
          const skills = fs
            .readdirSync(skillsDir, { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => {
              const file = path.join(skillsDir, e.name, "SKILL.md");
              let description = "";
              try {
                const raw = fs.readFileSync(file, "utf8");
                const m = /^description:\s*(.+)$/m.exec(raw);
                description = m?.[1]?.trim() ?? "";
              } catch {
                // skip unreadable
              }
              return { name: e.name, description };
            })
            .filter((s) => fs.existsSync(path.join(skillsDir, s.name, "SKILL.md")));
          return jsonResult({ status: "ok", skills, skillsDir });
        } catch (err) {
          return jsonResult({
            status: "error",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const name = readStringParam(params, "name");
      const slug = name ? toSlug(name) : "";
      if (!slug) {
        return jsonResult({
          status: "error",
          error: "A non-empty name is required for save/delete.",
        });
      }
      const skillDir = path.join(skillsDir, slug);

      if (action === "delete") {
        try {
          if (!fs.existsSync(skillDir)) {
            return jsonResult({ status: "error", error: `No skill named "${slug}".` });
          }
          fs.rmSync(skillDir, { recursive: true, force: true });
          return jsonResult({ status: "ok", deleted: slug });
        } catch (err) {
          return jsonResult({
            status: "error",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // action === "save"
      const description = readStringParam(params, "description");
      const body = readStringParam(params, "body");
      if (!description || !body) {
        return jsonResult({
          status: "error",
          error: "save requires name, description (when to use), and body (the parameterized steps).",
        });
      }
      // Frontmatter description must be single-line for the loader.
      const safeDescription = description.replace(/\s+/g, " ").trim();
      const frontmatter = `---\nname: ${slug}\ndescription: ${safeDescription}\n---\n\n`;
      const heading = `# ${name}\n\n`;
      const content = body.trimStart().startsWith("#")
        ? `${frontmatter}${body.trim()}\n`
        : `${frontmatter}${heading}${body.trim()}\n`;
      try {
        fs.mkdirSync(skillDir, { recursive: true });
        fs.writeFileSync(path.join(skillDir, "SKILL.md"), content, "utf8");
        return jsonResult({
          status: "ok",
          saved: slug,
          path: path.join(skillDir, "SKILL.md"),
          note: "Skill saved. It auto-loads from your workspace — you can now run it on request, or edit + save again to change what's parameterized.",
        });
      } catch (err) {
        return jsonResult({
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}
