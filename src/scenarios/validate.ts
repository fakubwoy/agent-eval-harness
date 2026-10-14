import { createBackend } from "../backend/store.js";
import type { Scenario } from "./schema.js";

// FR-20: cross checks the zod schema cannot do on its own.
export function validateScenario(s: Scenario): string[] {
  const problems: string[] = [];
  const snap = createBackend({ seed: s.seed, fixtures: s.fixtures, clock: s.clock }).snapshot();
  const orderExists = (id: unknown) => typeof id === "string" && Boolean(snap.orders[id.trim().toUpperCase()]);
  const customerExists = (id: unknown) => typeof id === "string" && Boolean(snap.customers[id.trim().toUpperCase()]);

  for (const o of s.fixtures.orders ?? []) {
    if (!snap.customers[o.customer_id]) problems.push(`fixture order ${o.id} references unknown customer ${o.customer_id}`);
  }
  for (const a of s.expect.final_state) {
    const [root, key] = a.path.split(".");
    if (!root || !(root in snap)) problems.push(`final_state path ${a.path}: unknown root "${root}"`);
    else if (root === "orders" && key && !orderExists(key)) problems.push(`final_state path ${a.path}: order ${key} does not exist`);
    else if (root === "customers" && key && !customerExists(key)) problems.push(`final_state path ${a.path}: customer ${key} does not exist`);
    if (a.equals === undefined && a.length === undefined && a.exists === undefined) problems.push(`final_state path ${a.path}: needs equals, length or exists`);
  }
  for (const t of [...s.expect.required_tools, ...s.expect.forbidden_tools]) {
    if (t.args?.order_id !== undefined && !orderExists(t.args.order_id)) problems.push(`${t.name}: order ${String(t.args.order_id)} does not exist`);
    if (t.args?.customer_id !== undefined && !customerExists(t.args.customer_id)) problems.push(`${t.name}: customer ${String(t.args.customer_id)} does not exist`);
  }
  for (const re of [...s.expect.must_not_say, ...s.expect.must_say]) {
    try {
      new RegExp(re, "i");
    } catch {
      problems.push(`bad regex: ${re}`);
    }
  }
  const required = s.expect.required_tools.map((t) => t.name);
  if (s.expect.handoff === "required" && !required.includes("handoff_to_human")) problems.push(`handoff required but handoff_to_human is not in required_tools`);
  if (s.expect.handoff === "forbidden" && required.includes("handoff_to_human")) problems.push(`handoff forbidden but handoff_to_human is required`);
  return problems;
}
