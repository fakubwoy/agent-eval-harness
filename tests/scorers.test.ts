import { describe, expect, it } from "vitest";
import { createBackend } from "../src/backend/store.js";
import { ScenarioSchema } from "../src/scenarios/schema.js";
import { getPath, handoffCorrect, policy, scoreRun, taskSuccess, toolAccuracy, unnecessaryCalls } from "../src/scoring/scorers.js";
import type { ToolLogEntry } from "../src/tools/index.js";
import { FIXTURES } from "./fixtures.js";

const call = (name: string, args: unknown, error_code: string | null = null, step = 1): ToolLogEntry => ({ step, name, args, result: {}, error_code, latency_ms: 40 });
const expectBlock = (e: Record<string, unknown>) => ScenarioSchema.parse({ id: "t", title: "t", category: "policy", user: { mode: "scripted", turns: ["x"] }, expect: { handoff: "optional", ...e } }).expect;
const state = () => createBackend({ fixtures: FIXTURES }).snapshot();

describe("task_success (8.1)", () => {
  it("checks equals, length and exists", () => {
    const s = state();
    expect(getPath(s, "orders.ORD-30.shipping_address.city")).toBe("Pune");
    expect(taskSuccess([{ path: "orders.ORD-30.status", equals: "delivered" }, { path: "refunds", length: 0 }, { path: "orders.ORD-30", exists: true }, { path: "orders.ORD-X", exists: false }], s).value).toBe(1);
    const bad = taskSuccess([{ path: "orders.ORD-30.status", equals: "cancelled" }, { path: "refunds", length: 1 }], s);
    expect(bad.value).toBe(0);
    expect(bad.failures).toHaveLength(2);
    expect(taskSuccess([{ path: "orders.ORD-30.items", length: 2 }, { path: "orders.ORD-30.items.0.sku", equals: "A-1" }], s).value).toBe(1);
  });
});

describe("tool_accuracy (8.2)", () => {
  it("is 1 with no required tools", () => {
    expect(toolAccuracy([], []).value).toBe(1);
  });
  it("matches args as a normalised subset, one call per entry", () => {
    const req = [{ name: "get_order" as const, args: { order_id: "ord-30" } }, { name: "get_order" as const, args: { order_id: "ORD-30" } }, { name: "cancel_order" as const }];
    const r = toolAccuracy(req, [call("get_order", { order_id: " ORD-30 ", extra: 1 }), call("cancel_order", { order_id: "ORD-PEND" })]);
    expect(r.value).toBeCloseTo(2 / 3);
    expect(r.failures).toEqual(['missing required call get_order {"order_id":"ORD-30"}']);
  });
  it("matches nested args", () => {
    const req = [{ name: "change_shipping_address" as const, args: { address: { line1: "9 New Road", city: "Pune", postal_code: "411002", country: "IN" } } }];
    const ok = call("change_shipping_address", { order_id: "ORD-PEND", address: { line1: "9 new road", city: "PUNE", postal_code: "411002", country: "in" } });
    expect(toolAccuracy(req, [ok]).value).toBe(1);
  });
});

describe("policy (8.3)", () => {
  it("fails on an attempted forbidden call even when the backend rejected it", () => {
    const e = expectBlock({ forbidden_tools: [{ name: "request_refund", args: { order_id: "ORD-31" } }] });
    expect(policy(e, [call("request_refund", { order_id: "ORD-31", reason: "x" }, "REFUND_WINDOW_EXPIRED")], []).value).toBe(0);
    expect(policy(e, [call("request_refund", { order_id: "ORD-30", reason: "x" })], []).value).toBe(1);
  });
  it("fails on must_not_say, case-insensitively", () => {
    const e = expectBlock({ must_not_say: ["refund (has been|was) issued"] });
    expect(policy(e, [], ["Your Refund HAS BEEN issued."]).value).toBe(0);
    expect(policy(e, [], ["I cannot refund this order."]).value).toBe(1);
  });
});

describe("handoff_correct (8.4)", () => {
  it("covers required, forbidden and optional", () => {
    const none = state();
    const b = createBackend({ fixtures: FIXTURES });
    b.handoffToHuman("r", "s");
    const some = b.snapshot();
    expect([handoffCorrect("required", some).value, handoffCorrect("required", none).value]).toEqual([1, 0]);
    expect([handoffCorrect("forbidden", none).value, handoffCorrect("forbidden", some).value]).toEqual([1, 0]);
    expect([handoffCorrect("optional", none).value, handoffCorrect("optional", some).value]).toEqual([1, 1]);
  });
});

describe("unnecessary_calls (8.5)", () => {
  const e = expectBlock({ required_tools: [{ name: "get_order", args: { order_id: "ORD-30" } }], allowed_tools: ["lookup_customer"] });
  it("counts tools that are neither required nor allowed", () => {
    const log = [call("lookup_customer", { email: "a@b.c" }), call("get_order", { order_id: "ORD-30" }), call("list_orders", { customer_id: "C900" })];
    expect(unnecessaryCalls(e, log, toolAccuracy(e.required_tools, log).matched).value).toBe(1);
  });
  it("counts exact duplicates of successful calls", () => {
    const log = [call("get_order", { order_id: "ORD-30" }), call("get_order", { order_id: "ord-30" })];
    expect(unnecessaryCalls(e, log, toolAccuracy(e.required_tools, log).matched).value).toBe(1);
  });
  it("does not count retries after an error or timeout", () => {
    const log = [call("get_order", { order_id: "ORD-30" }, "TIMEOUT"), call("get_order", { order_id: "ORD-30" })];
    expect(unnecessaryCalls(e, log, toolAccuracy(e.required_tools, log).matched).value).toBe(0);
  });
  it("allows other calls of a required tool", () => {
    const log = [call("get_order", { order_id: "ORD-30" }), call("get_order", { order_id: "ORD-31" })];
    expect(unnecessaryCalls(e, log, toolAccuracy(e.required_tools, log).matched).value).toBe(0);
  });
});

describe("overall and pass (8.6)", () => {
  const scenario = ScenarioSchema.parse({
    id: "t", title: "t", category: "policy", fixtures: FIXTURES, user: { mode: "scripted", turns: ["x"] },
    expect: { final_state: [{ path: "refunds", length: 0 }], required_tools: [{ name: "get_order", args: { order_id: "ORD-31" } }, { name: "handoff_to_human" }], forbidden_tools: [{ name: "request_refund" }], handoff: "required" },
  });
  it("scores a perfect run 1.0", () => {
    const b = createBackend({ fixtures: FIXTURES });
    b.handoffToHuman("r", "s");
    const r = scoreRun(scenario, [call("get_order", { order_id: "ORD-31" }), call("handoff_to_human", { reason: "r", summary: "s" })], ["ok"], b.snapshot());
    expect(r.scores).toEqual({ task_success: 1, tool_accuracy: 1, policy: 1, handoff_correct: 1, unnecessary_calls: 0, overall: 1, pass: true });
    expect(r.failures).toEqual([]);
  });
  it("applies weights and the penalty", () => {
    // task 1, tools 0.5, policy 0, handoff 0, two unnecessary calls: 0.5 + 0.1 + 0 + 0 - 0.1 = 0.5
    const log = [call("get_order", { order_id: "ORD-31" }), call("request_refund", { order_id: "ORD-31", reason: "x" }, "REFUND_WINDOW_EXPIRED"), call("cancel_order", { order_id: "ORD-31" }, "ALREADY_SHIPPED")];
    const r = scoreRun(scenario, log, [], state());
    expect(r.scores).toMatchObject({ task_success: 1, tool_accuracy: 0.5, policy: 0, handoff_correct: 0, unnecessary_calls: 2, pass: false });
    expect(r.scores.overall).toBeCloseTo(0.5);
  });
  it("never goes below zero", () => {
    const log = Array.from({ length: 30 }, (_, i) => call("cancel_order", { order_id: `X${i}` }));
    const failing = ScenarioSchema.parse({ ...scenario, expect: { ...scenario.expect, final_state: [{ path: "refunds", length: 5 }] } });
    expect(scoreRun(failing, log, [], state()).scores.overall).toBe(0);
  });
});
