import { describe, expect, it } from "vitest";
import { redactKnownSecrets, resetKnownSecretCache } from "./redact-known-secrets.js";

/**
 * The pattern layer catches secrets that look like secrets. This layer catches
 * the live credential itself, wherever it appears — including bare, with no
 * surrounding shape to match, which is what a file read returns.
 */
describe("redactKnownSecrets", () => {
  const KEY = "tgp_v1_ExampleKeyValueThatIsLongEnough";
  const OTHER = "sk-anotherExampleCredential123456";

  it("masks a bare credential with no surrounding context", () => {
    // A pattern matcher has nothing to grip here; an exact match does.
    const out = redactKnownSecrets(KEY, [KEY]);
    expect(out).not.toContain(KEY);
    expect(out).toContain("[redacted]");
  });

  it("keeps a short prefix so the reader knows which credential leaked", () => {
    expect(redactKnownSecrets(`key is ${KEY}`, [KEY])).toContain("tgp_…[redacted]");
  });

  it("masks every occurrence, not just the first", () => {
    const text = `${KEY} then again ${KEY}`;
    const out = redactKnownSecrets(text, [KEY]);
    expect(out).not.toContain(KEY);
    expect(out.match(/\[redacted\]/g)).toHaveLength(2);
  });

  it("masks several different credentials in one payload", () => {
    const out = redactKnownSecrets(`a=${KEY} b=${OTHER}`, [KEY, OTHER]);
    expect(out).not.toContain(KEY);
    expect(out).not.toContain(OTHER);
  });

  it("leaves ordinary text completely untouched", () => {
    const prose = "Read the config and report how much disk space is free.";
    expect(redactKnownSecrets(prose, [KEY])).toBe(prose);
  });

  it("does not mangle a code snippet that merely mentions the word key", () => {
    const code = 'const apiKey = process.env.MY_KEY; // load the key';
    expect(redactKnownSecrets(code, [KEY])).toBe(code);
  });

  it("handles empty input and an empty secret list", () => {
    expect(redactKnownSecrets("", [KEY])).toBe("");
    expect(redactKnownSecrets("hello", [])).toBe("hello");
  });

  it("masks a longer credential that contains a shorter one, whole", () => {
    const shortKey = "abcdefghij1234567890";
    const longKey = `${shortKey}-extended-suffix`;
    // Sorted longest-first by the collector, so the long one wins.
    const out = redactKnownSecrets(`token=${longKey}`, [longKey, shortKey]);
    expect(out).not.toContain(shortKey);
    expect(out).toContain("abcd…[redacted]");
  });

  it("exposes a cache reset for tests", () => {
    expect(() => resetKnownSecretCache()).not.toThrow();
  });
});
