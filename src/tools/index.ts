import { z } from "zod";
import { err, type Backend } from "../backend/store.js";
import { AddressSchema } from "../backend/types.js";
import { createFaultInjector, TOOL_LATENCY_MS, type Fault } from "./faults.js";

export const TOOL_NAMES = [
  "lookup_customer",
  "get_order",
  "list_orders",
  "request_refund",
  "change_shipping_address",
  "cancel_order",
  "handoff_to_human",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

type ToolDef<S extends z.ZodType = z.ZodType> = {
  name: ToolName;
  description: string;
  inputSchema: S;
  run: (backend: Backend, args: z.infer<S>) => unknown;
};

const def = <S extends z.ZodType>(d: ToolDef<S>): ToolDef => d as unknown as ToolDef;
const orderId = z.string().min(1).describe("Order id, for example ORD-1042");

export const TOOL_DEFS: ToolDef[] = [
  def({
    name: "lookup_customer",
    description: "Find a customer by email. Returns customer id, name and order ids.",
    inputSchema: z.object({ email: z.string().min(3) }),
    run: (b, a) => b.lookupCustomer(a.email),
  }),
  def({
    name: "get_order",
    description: "Get one order with status, dates, items, totals (integer cents) and shipping address.",
    inputSchema: z.object({ order_id: orderId }),
    run: (b, a) => b.getOrder(a.order_id),
  }),
  def({
    name: "list_orders",
    description: "List order summaries for a customer id.",
    inputSchema: z.object({ customer_id: z.string().min(1) }),
    run: (b, a) => b.listOrders(a.customer_id),
  }),
  def({
    name: "request_refund",
    description: "Refund a delivered order, or one item of it when sku is given.",
    inputSchema: z.object({ order_id: orderId, reason: z.string().min(1), sku: z.string().optional() }),
    run: (b, a) => b.requestRefund(a.order_id, a.reason, a.sku),
  }),
  def({
    name: "change_shipping_address",
    description: "Change the shipping address of an order that has not shipped yet.",
    inputSchema: z.object({ order_id: orderId, address: AddressSchema }),
    run: (b, a) => b.changeShippingAddress(a.order_id, a.address),
  }),
  def({
    name: "cancel_order",
    description: "Cancel an order that has not shipped yet.",
    inputSchema: z.object({ order_id: orderId }),
    run: (b, a) => b.cancelOrder(a.order_id),
  }),
  def({
    name: "handoff_to_human",
    description: "Hand the conversation to a human agent. Ends the conversation.",
    inputSchema: z.object({ reason: z.string().min(1), summary: z.string().min(1) }),
    run: (b, a) => b.handoffToHuman(a.reason, a.summary),
  }),
];

export type ToolLogEntry = {
  step: number;
  name: string;
  args: unknown;
  result: unknown;
  error_code: string | null;
  latency_ms: number;
};

export function errorCode(result: unknown): string | null {
  const e = (result as { error?: { code?: unknown } } | null)?.error;
  return typeof e?.code === "string" ? e.code : null;
}

export type Toolbox = ReturnType<typeof createToolbox>;

// Every tool call goes through `call`: faults, zod parsing, the backend, then the log. Nothing here throws.
export function createToolbox(backend: Backend, faults: Fault[] = []) {
  const log: ToolLogEntry[] = [];
  const inject = createFaultInjector(faults);
  let handedOff = false;

  function call(name: string, args: unknown, step: number): unknown {
    const tool = TOOL_DEFS.find((t) => t.name === name);
    const fault = tool ? inject(name) : null;
    let result: unknown;
    if (!tool) result = err("UNKNOWN_TOOL", `No tool named ${name}`);
    else if (fault) result = fault.result;
    else {
      const parsed = tool.inputSchema.safeParse(args);
      result = parsed.success ? tool.run(backend, parsed.data) : err("INVALID_ARGS", z.prettifyError(parsed.error));
    }
    const error_code = errorCode(result);
    if (name === "handoff_to_human" && error_code === null) handedOff = true;
    log.push({ step, name, args, result, error_code, latency_ms: fault?.latency_ms ?? TOOL_LATENCY_MS });
    return result;
  }

  return { defs: TOOL_DEFS, log, call, handedOff: () => handedOff };
}
