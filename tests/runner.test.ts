import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APICallError } from "ai";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { runEval } from "../src/runner.js";
import { ScenarioSchema } from "../src/scenarios/schema.js";
import { scriptedModel } from "./mock.js";

const example = ScenarioSchema.parse(parse(readFileSync("scenarios/policy-refund-past-30-days.yaml", "utf8")));
const scenarios = [example, { ...example, id: "copy-two" }, { ...example, id: "copy-three" }];
const pricing = { "openai:mock-agent": { input: 1, cached_input: 0.5, output: 2 } };
const tmp = () => mkdtempSync(join(tmpdir(), "aeh-"));

// A reasonable agent: looks up the order, refuses, hands off on the third message.
const agent = () =>
  scriptedModel((prompt) => {
    const last = JSON.stringify(prompt.at(-1));
    const users = prompt.filter((m: any) => m.role === "user").length;
    if (last.includes('"role":"tool"')) return { text: "That order is outside the 30 day refund window." };
    if (users === 1) return { calls: [["get_order", { order_id: "ORD-1042" }]] };
    if (users === 3) return { calls: [["handoff_to_human", { reason: "dispute", summary: "refund past window" }]] };
    return { text: "Thanks." };
  }, "mock-agent");

const noNetwork = () =>
  scriptedModel(() => {
    throw new Error("replay must not call the model");
  });

describe("runner", () => {
  it("record then replay gives identical runs.jsonl", async () => {
    const cassetteDir = tmp();
    const rec = await runEval({ scenarios, models: ["openai:mock-agent"], mode: "record", cassetteDir, outDir: tmp(), runId: "R1", pricing, resolveModel: agent, concurrency: 2 });
    expect(rec.records.every((r) => r.status === "completed")).toBe(true);
    expect(rec.records[0]!.scores.pass).toBe(true);
    expect(rec.records[0]!.ended_by).toBe("handoff");
    expect(readdirSync(join(cassetteDir, "openai", "mock-agent")).length).toBeGreaterThan(0);

    const rep1 = await runEval({ scenarios, models: ["openai:mock-agent"], mode: "replay", cassetteDir, outDir: tmp(), runId: "R1", pricing, resolveModel: noNetwork });
    const rep2 = await runEval({ scenarios, models: ["openai:mock-agent"], mode: "replay", cassetteDir, outDir: tmp(), runId: "R1", pricing, resolveModel: noNetwork });
    const file = (d: string) => readFileSync(join(d, "runs.jsonl"), "utf8");
    expect(file(rep2.outDir)).toBe(file(rep1.outDir));
    // record and replay differ only in the mode field
    expect(file(rep1.outDir).replaceAll('"mode":"replay"', '"mode":"record"')).toBe(file(rec.outDir));
    expect(rep1.summary.cost.spent_usd).toBe(0);
    expect(rep1.summary.models[0]!.total_cost_usd).toBe(rec.summary.models[0]!.total_cost_usd);
  });

  it("a replay miss fails clearly with the scenario id and hash", async () => {
    const r = await runEval({ scenarios: [example], models: ["openai:mock-agent"], mode: "replay", cassetteDir: tmp(), outDir: tmp(), resolveModel: noNetwork });
    expect(r.records[0]!.status).toBe("error");
    expect(r.records[0]!.error).toMatch(/Replay miss: scenario policy-refund-past-30-days, model openai:mock-agent, trial 1, request hash [0-9a-f]{64}/);
    expect(r.summary.notes.join()).toMatch(/Replay miss/);
  });

  it("stops at the cost cap and marks runs aborted", async () => {
    // each call: 100 input (20 cached), 10 output tokens at $1000 / $500 / $2000 per 1M = $0.11
    const pricey = { "openai:mock-agent": { input: 1000, cached_input: 500, output: 2000 } };
    const r = await runEval({ scenarios, models: ["openai:mock-agent"], mode: "live", outDir: tmp(), pricing: pricey, maxCostUsd: 0.2, resolveModel: agent, concurrency: 1 });
    expect(r.records.map((x) => x.status)).toEqual(["aborted", "aborted", "aborted"]);
    expect(r.records.every((x) => x.aborted === "cost_cap")).toBe(true);
    expect(r.summary.cost.cap_hit).toBe(true);
    expect(r.summary.cost.spent_usd).toBeCloseTo(0.22, 6);
    expect(r.summary.cost.spent_usd).toBeLessThanOrEqual(0.2 + 0.11);
  });

  it("runs every trial and computes pass^k", async () => {
    const r = await runEval({ scenarios: [example], models: ["openai:mock-agent"], trials: 2, mode: "live", outDir: tmp(), pricing, resolveModel: agent });
    expect(r.records.map((x) => x.trial)).toEqual([1, 2]);
    expect(r.summary.models[0]!.pass_k).toBe(1);
  });

  it("records a provider rejection of the model output as a scored model failure and replays it", async () => {
    const cassetteDir = tmp();
    const rejecting = () =>
      scriptedModel(() => {
        throw new APICallError({ message: "tool call validation failed: attempted to call tool 'handful_to_human'", url: "x", requestBodyValues: {}, statusCode: 400, responseBody: '{"error":{"code":"tool_use_failed"}}', isRetryable: false });
      }, "mock-agent");
    const rec = await runEval({ scenarios: [example], models: ["openai:mock-agent"], mode: "record", cassetteDir, outDir: tmp(), runId: "R2", pricing, resolveModel: rejecting });
    expect(rec.records[0]).toMatchObject({ status: "completed", ended_by: "error", scores: { pass: false } });
    expect(rec.records[0]!.failures[0]).toMatch(/^model error: Provider rejected the model output: tool call validation failed/);
    const rep = await runEval({ scenarios: [example], models: ["openai:mock-agent"], mode: "replay", cassetteDir, outDir: tmp(), runId: "R2", pricing, resolveModel: noNetwork });
    expect(rep.records[0]!.failures).toEqual(rec.records[0]!.failures);
  });

  it("keeps other 400 errors as harness errors", async () => {
    const bad = () =>
      scriptedModel(() => {
        throw new APICallError({ message: "invalid request body", url: "x", requestBodyValues: {}, statusCode: 400, isRetryable: false });
      }, "mock-agent");
    const r = await runEval({ scenarios: [example], models: ["openai:mock-agent"], mode: "live", outDir: tmp(), pricing, resolveModel: bad });
    expect(r.records[0]!.status).toBe("error");
  });

  it("refuses paid runs for models without a price", async () => {
    await expect(runEval({ scenarios: [example], models: ["openai:unpriced"], mode: "live", outDir: tmp(), resolveModel: agent })).rejects.toThrow(/No price for openai:unpriced/);
  });
});
