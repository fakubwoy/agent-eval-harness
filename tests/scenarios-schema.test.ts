import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { loadScenarios } from "../src/scenarios/loader.js";
import { CATEGORIES, CATEGORY_MINIMUMS, ScenarioSchema } from "../src/scenarios/schema.js";
import { validateScenario } from "../src/scenarios/validate.js";

const example = parse(readFileSync("scenarios/policy-refund-past-30-days.yaml", "utf8"));

describe("scenario schema", () => {
  it("accepts the example", () => {
    const s = ScenarioSchema.parse(example);
    expect(s.limits.max_turns).toBe(6);
    expect(s.limits.max_steps_per_turn).toBe(8);
    expect(validateScenario(s)).toEqual([]);
  });

  const broken: [string, (s: any) => void, string][] = [
    ["missing id", (s) => delete s.id, "id"],
    ["bad category", (s) => (s.category = "refunds"), "category"],
    ["scripted with no turns", (s) => delete s.user.turns, "user.turns"],
    ["unknown tool name", (s) => (s.expect.required_tools[0].name = "refund_everything"), "expect.required_tools.0.name"],
  ];
  for (const [name, mutate, path] of broken) {
    it(`rejects ${name}`, () => {
      const copy = structuredClone(example);
      mutate(copy);
      const r = ScenarioSchema.safeParse(copy);
      expect(r.success).toBe(false);
      expect(r.error!.issues.map((i) => i.path.join("."))).toContain(path);
    });
  }

  it("validate catches references to missing orders", () => {
    const s = ScenarioSchema.parse(example);
    s.expect.final_state.push({ path: "orders.ORD-0000.status", equals: "delivered" });
    expect(validateScenario(s).join()).toMatch(/ORD-0000 does not exist/);
  });
});

describe("scenario set", () => {
  const all = loadScenarios();
  it("loads, validates and meets every category minimum", () => {
    expect(all.length).toBeGreaterThanOrEqual(40);
    expect(all.length).toBeLessThanOrEqual(45);
    for (const c of CATEGORIES) expect(all.filter((s) => s.category === c).length, c).toBeGreaterThanOrEqual(CATEGORY_MINIMUMS[c]);
    expect(all.filter((s) => s.user.mode === "llm").length).toBeGreaterThanOrEqual(5);
    for (const s of all) expect(validateScenario(s), s.id).toEqual([]);
  });
});
