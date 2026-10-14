import { describe, expect, it } from "vitest";
import { createBackend } from "../src/backend/store.js";
import { TOOL_TIMEOUT_MS } from "../src/tools/faults.js";
import { createToolbox } from "../src/tools/index.js";
import { FIXTURES } from "./fixtures.js";

describe("faults", () => {
  it("error mode hits the first N calls of that tool only", () => {
    const t = createToolbox(createBackend({ fixtures: FIXTURES }), [{ tool: "get_order", mode: "error", times: 2 }]);
    for (const step of [1, 2, 3]) t.call("get_order", { order_id: "ORD-30" }, step);
    expect(t.log.map((e) => e.error_code)).toEqual(["UPSTREAM_ERROR", "UPSTREAM_ERROR", null]);
    expect(t.call("lookup_customer", { email: "test.person@example.com" }, 4)).toMatchObject({ customer_id: "C900" });
  });

  it("timeout mode records simulated latency and does not change state", () => {
    const backend = createBackend({ fixtures: FIXTURES });
    const t = createToolbox(backend, [{ tool: "cancel_order", mode: "timeout", times: 1 }]);
    const start = Date.now();
    expect(t.call("cancel_order", { order_id: "ORD-PEND" }, 1)).toMatchObject({ error: { code: "TIMEOUT" } });
    expect(Date.now() - start).toBeLessThan(1000);
    expect(t.log[0]!.latency_ms).toBe(TOOL_TIMEOUT_MS);
    expect(backend.snapshot().orders["ORD-PEND"]!.status).toBe("pending");
    expect(t.call("cancel_order", { order_id: "ORD-PEND" }, 2)).toMatchObject({ status: "cancelled" });
  });
});
