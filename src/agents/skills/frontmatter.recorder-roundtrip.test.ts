import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "./frontmatter.js";

/**
 * The skill recorder writes frontmatter by string concatenation:
 *   `---\nname: ${slug}\ndescription: ${description}\n---\n\n`
 * and its own guidance asks the description to say WHEN to use the skill, which
 * invites phrasings like "Use when: ...". A saved skill whose description is
 * silently mangled would still load but stop being selected correctly, so this
 * pins the round-trip for the shapes a model actually produces.
 */
function recorderFrontmatter(slug: string, description: string): string {
  const safeDescription = description.replace(/\s+/g, " ").trim();
  return `---\nname: ${slug}\ndescription: ${safeDescription}\n---\n\n# Title\n\nSteps.\n`;
}

describe("skill recorder frontmatter round-trip", () => {
  const cases: Array<[label: string, description: string]> = [
    ["plain prose", "Files a weekly expense report"],
    ["colon after a lead-in", "Use when: the user asks for a weekly report"],
    ["multiple colons", "Use when: the user says: file my report"],
    ["quotes", 'Use when the user says "file my report"'],
    ["hash", "#weekly report filing"],
    ["dash lead", "- files the weekly report"],
    ["braces", "Handles {customer} report filing"],
    ["percent", "Files the report at 100% completion"],
    ["at sign", "@mentions the finance team"],
  ];

  for (const [label, description] of cases) {
    it(`preserves the description with ${label}`, () => {
      const parsed = parseFrontmatter(recorderFrontmatter("weekly-report", description));
      expect(parsed.name).toBe("weekly-report");
      expect(parsed.description?.trim()).toBe(description);
    });
  }
});
