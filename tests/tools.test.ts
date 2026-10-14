import { describe, expect, it } from "vitest";
import { createBackend } from "../src/backend/store.js";
import { createToolbox } from "../src/tools/index.js";
import { CLOCK, FIXTURES } from "./fixtures.js";

const box = () => {
  const backend = createBackend({ fixtures: FIXTURES, clock: CLOCK });
  return { backend, ...createToolbox(backend) };
};
const newAddress = { line1: "9 New Road", city: "Pune", postal_code: "411002", country: "IN" };

describe("tools", () => {
  it("lookup_customer finds by email case-insensitively and errors otherwise", () => {
    const t = box();
    expect(t.call("lookup_customer", { email: " Test.Person@example.com " }, 1)).toMatchObject({ customer_id: "C900" });
    expect(t.call("lookup_customer", { email: "nobody@example.com" }, 1)).toMatchObject({ error: { code: "CUSTOMER_NOT_FOUND" } });
  });

  it("get_order and list_orders", () => {
    const t = box();
    expect(t.call("get_order", { order_id: "ord-30" }, 1)).toMatchObject({ id: "ORD-30", status: "delivered" });
    expect(t.call("get_order", { order_id: "ORD-404" }, 1)).toMatchObject({ error: { code: "ORDER_NOT_FOUND" } });
    expect((t.call("list_orders", { customer_id: "C900" }, 1) as { orders: unknown[] }).orders).toHaveLength(4);
    expect(t.call("list_orders", { customer_id: "C404" }, 1)).toMatchObject({ error: { code: "CUSTOMER_NOT_FOUND" } });
  });

  it("change_shipping_address works before shipping and returns ALREADY_SHIPPED after", () => {
    const t = box();
    expect(t.call("change_shipping_address", { order_id: "ORD-PEND", address: newAddress }, 1)).toMatchObject({ shipping_address: newAddress });
    expect(t.backend.snapshot().address_changes).toHaveLength(1);
    expect(t.call("change_shipping_address", { order_id: "ORD-SHIP", address: newAddress }, 1)).toMatchObject({ error: { code: "ALREADY_SHIPPED" } });
    expect(t.call("change_shipping_address", { order_id: "ORD-30", address: newAddress }, 1)).toMatchObject({ error: { code: "ALREADY_SHIPPED" } });
  });

  it("cancel_order works before shipping and returns ALREADY_SHIPPED after", () => {
    const t = box();
    expect(t.call("cancel_order", { order_id: "ORD-PEND" }, 1)).toMatchObject({ status: "cancelled" });
    expect(t.call("cancel_order", { order_id: "ORD-PEND" }, 1)).toMatchObject({ error: { code: "ORDER_CANCELLED" } });
    expect(t.call("cancel_order", { order_id: "ORD-SHIP" }, 1)).toMatchObject({ error: { code: "ALREADY_SHIPPED" } });
  });

  it("request_refund returns backend errors as data", () => {
    const t = box();
    expect(t.call("request_refund", { order_id: "ORD-31", reason: "late" }, 1)).toMatchObject({ error: { code: "REFUND_WINDOW_EXPIRED" } });
  });

  it("handoff_to_human sets the flag", () => {
    const t = box();
    expect(t.handedOff()).toBe(false);
    t.call("handoff_to_human", { reason: "asked", summary: "wants a human" }, 3);
    expect(t.handedOff()).toBe(true);
    expect(t.backend.snapshot().handoffs).toHaveLength(1);
  });

  it("bad arguments come back as INVALID_ARGS without throwing", () => {
    const t = box();
    const bad: [string, unknown][] = [
      ["lookup_customer", {}],
      ["get_order", { order_id: 42 }],
      ["list_orders", null],
      ["request_refund", { order_id: "ORD-30" }],
      ["change_shipping_address", { order_id: "ORD-PEND", address: { line1: "x", city: "y", country: "IN" } }],
      ["cancel_order", "ORD-PEND"],
      ["handoff_to_human", { reason: "" }],
    ];
    for (const [name, args] of bad) expect(t.call(name, args, 1)).toMatchObject({ error: { code: "INVALID_ARGS" } });
    expect(t.call("delete_everything", {}, 1)).toMatchObject({ error: { code: "UNKNOWN_TOOL" } });
    expect(t.backend.snapshot().handoffs).toHaveLength(0);
  });

  it("logs every call with step, args, result and error code", () => {
    const t = box();
    t.call("get_order", { order_id: "ORD-30" }, 2);
    t.call("get_order", { order_id: "ORD-404" }, 3);
    expect(t.log.map((e) => [e.step, e.name, e.error_code])).toEqual([
      [2, "get_order", null],
      [3, "get_order", "ORDER_NOT_FOUND"],
    ]);
    expect(t.log[0]!.args).toEqual({ order_id: "ORD-30" });
    expect(t.log[0]!.latency_ms).toBeGreaterThan(0);
  });
});
