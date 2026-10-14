import { describe, expect, it } from "vitest";
import { runAgentTurn, promptHash } from "../src/agent/loop.js";
import { createBackend } from "../src/backend/store.js";
import { costUsd } from "../src/providers/pricing.js";
import { createToolbox } from "../src/tools/index.js";
import { FIXTURES } from "./fixtures.js";
import { scriptedModel } from "./mock.js";

const toolbox = (faults = []) => createToolbox(createBackend({ fixtures: FIXTURES }), faults);
const user = (content: string) => [{ role: "user" as const, content }];

describe("runAgentTurn", () => {
  it("calls a tool, feeds back the result and answers", async () => {
    const box = toolbox();
    const model = scriptedModel([{ calls: [["get_order", { order_id: "ORD-30" }]] }, { text: "Your order was delivered." }]);
    const r = await runAgentTurn(user("where is ORD-30?"), box, model);
    expect(r.text).toBe("Your order was delivered.");
    expect(r.steps).toHaveLength(2);
    expect(r.messages.map((m) => m.role)).toEqual(["assistant", "tool", "assistant"]);
    expect(box.log).toMatchObject([{ step: 1, name: "get_order", error_code: null, result: { id: "ORD-30" } }]);
    const prompt2 = JSON.stringify(model.doGenerateCalls[1]!.prompt);
    expect(prompt2).toContain('"status":"delivered"');
  });

  it("passes tool errors back so the model can recover", async () => {
    const box = toolbox();
    const model = scriptedModel([
      { calls: [["get_order", { order_id: "ORD-999" }]] },
      { calls: [["get_order", { order_id: "ORD-30" }]] },
      { text: "Found it." },
    ]);
    const r = await runAgentTurn(user("order 999"), box, model, { stepOffset: 4 });
    expect(JSON.stringify(model.doGenerateCalls[1]!.prompt)).toContain("ORDER_NOT_FOUND");
    expect(box.log.map((e) => [e.step, e.error_code])).toEqual([[5, "ORDER_NOT_FOUND"], [6, null]]);
    expect(r.text).toBe("Found it.");
  });

  it("returns invalid arguments to the model as INVALID_ARGS", async () => {
    const box = toolbox();
    const model = scriptedModel([{ calls: [["get_order", { id: 5 }]] }, { text: "Which order?" }]);
    await runAgentTurn(user("hi"), box, model);
    expect(box.log[0]!.error_code).toBe("INVALID_ARGS");
    expect(JSON.stringify(model.doGenerateCalls[1]!.prompt)).toContain("INVALID_ARGS");
  });

  it("stops a model that calls tools forever at the step limit", async () => {
    const box = toolbox();
    const model = scriptedModel([{ calls: [["get_order", { order_id: "ORD-30" }]] }]);
    const r = await runAgentTurn(user("loop"), box, model, { maxSteps: 3 });
    expect(r.hit_step_limit).toBe(true);
    expect(r.steps).toHaveLength(3);
    expect(box.log).toHaveLength(3);
  });

  it("stops right after a handoff", async () => {
    const box = toolbox();
    const model = scriptedModel([{ calls: [["handoff_to_human", { reason: "asked", summary: "s" }]] }, { text: "never" }]);
    const r = await runAgentTurn(user("human please"), box, model);
    expect(r.handed_off).toBe(true);
    expect(r.steps).toHaveLength(1);
  });

  it("captures usage per step and costs it", async () => {
    const box = toolbox();
    const model = scriptedModel([{ calls: [["get_order", { order_id: "ORD-30" }]] }, { text: "ok" }]);
    const r = await runAgentTurn(user("x"), box, model);
    expect(r.steps.map(({ input_tokens, cached_input_tokens, output_tokens }) => [input_tokens, cached_input_tokens, output_tokens])).toEqual([[100, 20, 10], [100, 20, 10]]);
    const total = r.steps.reduce((a, s) => ({ input_tokens: a.input_tokens + s.input_tokens, cached_input_tokens: a.cached_input_tokens + s.cached_input_tokens, output_tokens: a.output_tokens + s.output_tokens }), { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 });
    // (200 - 40) * 0.4 + 40 * 0.1 + 20 * 1.6 = 100 micro dollars
    expect(costUsd("openai:gpt-4.1-mini", total)).toBeCloseTo(0.0001, 10);
    expect(costUsd("nobody:unknown", total)).toBeNull();
  });

  it("sends temperature 0 and a stable prompt hash", async () => {
    const box = toolbox();
    const model = scriptedModel([{ text: "hi" }]);
    await runAgentTurn(user("x"), box, model);
    expect(model.doGenerateCalls[0]!.temperature).toBe(0);
    expect(promptHash(box)).toMatch(/^[0-9a-f]{64}$/);
    expect(promptHash(box)).toBe(promptHash(toolbox()));
  });
});
