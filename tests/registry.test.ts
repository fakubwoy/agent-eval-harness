import { describe, expect, it } from "vitest";
import { PRICING } from "../src/providers/pricing.js";
import { DEFAULT_MODELS, DEFAULT_USER_MODEL, getModel, parseSpec } from "../src/providers/registry.js";

describe("registry", () => {
  it("parses provider:model including slashes in the id", () => {
    expect(parseSpec("groq:openai/gpt-oss-120b")).toEqual({ provider: "groq", id: "openai/gpt-oss-120b" });
    expect(() => parseSpec("nope:x")).toThrow(/provider:model/);
    expect(() => parseSpec("openai:")).toThrow();
  });

  it("names the env var when a required key is missing", () => {
    const saved = process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEY;
    expect(() => getModel("groq:openai/gpt-oss-120b", { requireKey: true })).toThrow(/GROQ_API_KEY/);
    if (saved !== undefined) process.env.GROQ_API_KEY = saved;
  });

  it("has prices for every default model", () => {
    for (const m of [...DEFAULT_MODELS, DEFAULT_USER_MODEL]) expect(PRICING[m]).toBeDefined();
  });
});
