import { generateText } from "ai";
import { describe, expect, it } from "vitest";
import { DEFAULT_MODELS, getModel, hasKey } from "../src/providers/registry.js";

// One short real call per provider; skipped when its key is missing, so CI and npm test stay offline.
describe("live smoke", () => {
  for (const spec of DEFAULT_MODELS) {
    it.skipIf(!hasKey(spec))(`${spec} answers`, async () => {
      const r = await generateText({ model: getModel(spec, { requireKey: true }), prompt: "Reply with the word ok.", maxOutputTokens: 20 });
      expect(r.text.toLowerCase()).toContain("ok");
    }, 30_000);
  }
});
