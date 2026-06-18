import { describe, expect, it } from "vitest";
import { classifyTaskHeuristic } from "./classify.js";

describe("classifyTaskHeuristic", () => {
  it("classifies explicit web tasks as browser", () => {
    expect(classifyTaskHeuristic("open youtube and play lo-fi music")).toBe("browser");
    expect(classifyTaskHeuristic("go to https://example.com and fill the contact form")).toBe(
      "browser",
    );
    expect(classifyTaskHeuristic("search for laptop prices on amazon")).toBe("browser");
    expect(classifyTaskHeuristic("log in to my gmail account")).toBe("browser");
    expect(classifyTaskHeuristic("book a flight ticket from delhi to mumbai")).toBe("browser");
    expect(classifyTaskHeuristic("fill this form: www.acme.com/jobs/apply")).toBe("browser");
  });

  it("classifies native Windows tasks as desktop", () => {
    expect(classifyTaskHeuristic("open notepad and type hello world")).toBe("desktop");
    expect(classifyTaskHeuristic("create a new folder on my desktop called invoices")).toBe(
      "desktop",
    );
    expect(classifyTaskHeuristic("open task manager and check cpu usage")).toBe("desktop");
    expect(classifyTaskHeuristic("set the volume to 50 percent")).toBe("desktop");
    expect(classifyTaskHeuristic("uninstall the vlc application")).toBe("desktop");
    expect(classifyTaskHeuristic("open excel and make a budget sheet")).toBe("desktop");
  });

  it("treats informational questions as chat even when they mention apps or sites", () => {
    expect(classifyTaskHeuristic("how do I open notepad on windows?")).toBe("chat");
    expect(classifyTaskHeuristic("what is the best browser for privacy?")).toBe("chat");
    expect(classifyTaskHeuristic("explain how google search ranking works")).toBe("chat");
  });

  it("returns unknown when there is no confident signal", () => {
    expect(classifyTaskHeuristic("good morning")).toBe("unknown");
    expect(classifyTaskHeuristic("write a poem about the sea")).toBe("unknown");
    expect(classifyTaskHeuristic("yes, continue")).toBe("unknown");
    expect(classifyTaskHeuristic("")).toBe("unknown");
  });

  it("does not mistake common English for app names", () => {
    expect(classifyTaskHeuristic("reply with exactly one word: ready")).toBe("unknown");
    expect(classifyTaskHeuristic("you excel at math problems")).toBe("unknown");
    expect(classifyTaskHeuristic("paint a sunset in your description")).toBe("unknown");
    expect(classifyTaskHeuristic("calculate the volume of a cylinder with radius 2")).toBe(
      "unknown",
    );
  });

  it("still detects office apps with app-like context", () => {
    expect(classifyTaskHeuristic("open word and write a letter")).toBe("desktop");
    expect(classifyTaskHeuristic("open paint and draw a circle")).toBe("desktop");
    expect(classifyTaskHeuristic("put the numbers in an excel sheet")).toBe("desktop");
    expect(classifyTaskHeuristic("open microsoft word")).toBe("desktop");
  });

  it("ignores the gateway-injected timestamp prefix", () => {
    expect(classifyTaskHeuristic("[Thu 2026-06-12 10:00 IST] open notepad and type hi")).toBe(
      "desktop",
    );
    expect(classifyTaskHeuristic("[Thu 2026-06-12 10:00 IST] what is a vpn?")).toBe("chat");
  });
});
