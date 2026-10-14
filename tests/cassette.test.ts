import { describe, expect, it } from "vitest";
import { cassettePath, requestHash, toJson } from "../src/providers/cassette.js";

const params = { prompt: [{ role: "user" as const, content: [{ type: "text" as const, text: "hi" }] }], temperature: 0 };

describe("cassette hashing", () => {
  it("is stable across key order and ignores headers and abort signals", () => {
    const a = requestHash("openai:x", "s1", 1, params);
    const reordered = { temperature: 0, prompt: params.prompt, headers: { authorization: "secret" }, abortSignal: new AbortController().signal };
    expect(requestHash("openai:x", "s1", 1, reordered)).toBe(a);
  });

  it("changes with model, scenario, trial and prompt", () => {
    const a = requestHash("openai:x", "s1", 1, params);
    expect(requestHash("openai:y", "s1", 1, params)).not.toBe(a);
    expect(requestHash("openai:x", "s2", 1, params)).not.toBe(a);
    expect(requestHash("openai:x", "s1", 2, params)).not.toBe(a);
    expect(requestHash("openai:x", "s1", 1, { ...params, temperature: 1 })).not.toBe(a);
  });

  it("keeps agent hashes unchanged and separates customer cassettes per agent model", () => {
    const a = requestHash("openai:x", "s1", 1, params);
    expect(requestHash("openai:x", "s1", 1, params, undefined)).toBe(a);
    expect(requestHash("anthropic:u", "s1", 1, params, "openai:x")).not.toBe(requestHash("anthropic:u", "s1", 1, params, "groq:y"));
  });

  it("writes dashes as escapes that parse back to the same text", () => {
    const value = { text: "June 15 \u2014 exactly 31 days, 9\u201310 am" };
    const json = toJson(value, 2);
    expect(json).not.toMatch(/[\u2013\u2014]/);
    expect(JSON.parse(json)).toEqual(value);
  });

  it("keeps model ids with slashes in one directory", () => {
    expect(cassettePath("cassettes", "groq:openai/gpt-oss-120b", "abc")).toBe("cassettes/groq/openai_gpt-oss-120b/abc.json");
  });
});
