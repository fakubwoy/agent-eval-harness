import { describe, expect, it } from "vitest";
import { createBackend } from "../src/backend/store.js";
import { CLOCK, FIXTURES } from "./fixtures.js";

describe("backend", () => {
  it("is deterministic for the same seed and fixtures", () => {
    const a = createBackend({ seed: 7, fixtures: FIXTURES, clock: CLOCK }).snapshot();
    const b = createBackend({ seed: 7, fixtures: FIXTURES, clock: CLOCK }).snapshot();
    expect(a).toEqual(b);
    expect(Object.keys(a.customers).length).toBeGreaterThanOrEqual(20);
    expect(Object.keys(a.orders).length).toBeGreaterThanOrEqual(60);
  });

  it("differs across seeds", () => {
    expect(createBackend({ seed: 1 }).snapshot()).not.toEqual(createBackend({ seed: 2 }).snapshot());
  });

  it("never dates seeded orders after the clock", () => {
    const s = createBackend({ seed: 3 }).snapshot();
    for (const o of Object.values(s.orders)) {
      for (const d of [o.placed_at, o.shipped_at, o.delivered_at]) if (d) expect(Date.parse(d)).toBeLessThanOrEqual(Date.parse(CLOCK));
    }
  });

  it("overrides base records by id and adds new ones", () => {
    const b = createBackend({ fixtures: { customers: [{ id: "C001", name: "Override", email: "o@example.com" }], orders: FIXTURES.orders } });
    const s = b.snapshot();
    expect(s.customers.C001!.name).toBe("Override");
    expect(s.orders["ORD-30"]!.total_cents).toBe(7000);
  });

  it("snapshot is a copy", () => {
    const b = createBackend({ fixtures: FIXTURES });
    b.snapshot().orders["ORD-PEND"]!.status = "cancelled";
    expect(b.snapshot().orders["ORD-PEND"]!.status).toBe("pending");
  });

  describe("refund rules", () => {
    const fresh = () => createBackend({ fixtures: FIXTURES, clock: CLOCK });
    it("allows a refund exactly 30 days after delivery", () => {
      const b = fresh();
      expect(b.requestRefund("ORD-30", "broken")).toMatchObject({ refund: { amount_cents: 7000 } });
      expect(b.snapshot().refunds).toHaveLength(1);
    });
    it("rejects a refund 31 days after delivery", () => {
      expect(fresh().requestRefund("ORD-31", "broken")).toMatchObject({ error: { code: "REFUND_WINDOW_EXPIRED" } });
    });
    it("rejects non delivered orders", () => {
      expect(fresh().requestRefund("ORD-SHIP", "x")).toMatchObject({ error: { code: "NOT_DELIVERED" } });
      expect(fresh().requestRefund("ORD-PEND", "x")).toMatchObject({ error: { code: "NOT_DELIVERED" } });
    });
    it("rejects double refunds, including item after full", () => {
      const b = fresh();
      b.requestRefund("ORD-30", "x");
      expect(b.requestRefund("ORD-30", "x")).toMatchObject({ error: { code: "ALREADY_REFUNDED" } });
      expect(b.requestRefund("ORD-30", "x", "A-1")).toMatchObject({ error: { code: "ALREADY_REFUNDED" } });
    });
    it("refunds one item by sku and allows a different item later", () => {
      const b = fresh();
      expect(b.requestRefund("ord-30", "x", "a-1")).toMatchObject({ refund: { sku: "A-1", amount_cents: 2000 } });
      expect(b.requestRefund("ORD-30", "x", "B-2")).toMatchObject({ refund: { sku: "B-2", amount_cents: 5000 } });
      expect(b.requestRefund("ORD-30", "x", "Z-9")).toMatchObject({ error: { code: "SKU_NOT_FOUND" } });
    });
  });
});
