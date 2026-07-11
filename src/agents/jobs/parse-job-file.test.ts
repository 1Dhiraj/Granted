import { describe, expect, it } from "vitest";
import { parseJobFile } from "./parse-job-file.js";

describe("parseJobFile", () => {
  it("counts checked and unchecked boxes and picks a heading title", () => {
    const md = [
      "# Migrate the billing table",
      "",
      "- [x] back up rows",
      "- [X] add new column",
      "- [ ] backfill values",
      "* [ ] drop old column",
    ].join("\n");
    expect(parseJobFile("billing.md", md)).toEqual({
      title: "Migrate the billing table",
      done: 2,
      total: 4,
      status: "in-progress",
    });
  });

  it("is done when every box is checked", () => {
    const md = "# Done job\n- [x] a\n- [x] b";
    expect(parseJobFile("done.md", md)).toMatchObject({ status: "done", done: 2, total: 2 });
  });

  it("is pending when nothing is checked", () => {
    const md = "# Fresh job\n- [ ] a\n- [ ] b";
    expect(parseJobFile("fresh.md", md)).toMatchObject({ status: "pending", done: 0, total: 2 });
  });

  it("treats a checkbox-less file as a note and falls back to the filename", () => {
    expect(parseJobFile("notes.md", "just some prose, no tasks")).toEqual({
      title: "notes",
      done: 0,
      total: 0,
      status: "note",
    });
  });

  it("ignores non-checkbox brackets and inline text", () => {
    const md = "# Job\nSee [link](x) and array[0].\n- [x] real task";
    expect(parseJobFile("j.md", md)).toMatchObject({ done: 1, total: 1, status: "done" });
  });
});
