import { createBaseData } from "./seed.js";
import { isShipped, refundBlock } from "./rules.js";
import {
  DEFAULT_CLOCK,
  type Address,
  type Fixtures,
  type Order,
  type OrderInput,
  type Snapshot,
  type ToolError,
} from "./types.js";

export const err = (code: string, message: string): ToolError => ({ error: { code, message } });

function toOrder(o: OrderInput): Order {
  return {
    ...o,
    shipped_at: o.shipped_at ?? null,
    delivered_at: o.delivered_at ?? null,
    total_cents: o.total_cents ?? o.items.reduce((sum, it) => sum + it.qty * it.unit_price_cents, 0),
  };
}

export type Backend = ReturnType<typeof createBackend>;

export function createBackend({ seed = 42, fixtures = {}, clock = DEFAULT_CLOCK }: { seed?: number; fixtures?: Fixtures; clock?: string } = {}) {
  const base = createBaseData(seed, clock);
  const state: Snapshot = { customers: {}, orders: {}, refunds: [], handoffs: [], address_changes: [] };
  for (const c of [...base.customers, ...(fixtures.customers ?? [])]) state.customers[c.id] = structuredClone(c);
  for (const o of [...base.orders, ...(fixtures.orders ?? [])]) state.orders[o.id] = toOrder(structuredClone(o));

  const id = (s: string) => s.trim().toUpperCase();
  const findOrder = (orderId: string) => state.orders[id(orderId)];
  const notFound = (orderId: string) => err("ORDER_NOT_FOUND", `No order with id ${orderId}`);

  return {
    clock,
    snapshot: (): Snapshot => structuredClone(state),

    lookupCustomer(email: string) {
      const c = Object.values(state.customers).find((x) => x.email.toLowerCase() === email.trim().toLowerCase());
      if (!c) return err("CUSTOMER_NOT_FOUND", `No customer with email ${email}`);
      const orderIds = Object.values(state.orders).filter((o) => o.customer_id === c.id).map((o) => o.id);
      return { customer_id: c.id, name: c.name, order_ids: orderIds };
    },

    getOrder(orderId: string) {
      const o = findOrder(orderId);
      return o ? structuredClone(o) : notFound(orderId);
    },

    listOrders(customerId: string) {
      if (!state.customers[id(customerId)]) return err("CUSTOMER_NOT_FOUND", `No customer with id ${customerId}`);
      const orders = Object.values(state.orders)
        .filter((o) => o.customer_id === id(customerId))
        .map((o) => ({ id: o.id, status: o.status, placed_at: o.placed_at, total_cents: o.total_cents, items: o.items.map((i) => i.name) }));
      return { orders };
    },

    requestRefund(orderId: string, reason: string, sku?: string) {
      const o = findOrder(orderId);
      if (!o) return notFound(orderId);
      const item = sku === undefined ? undefined : o.items.find((i) => i.sku.toUpperCase() === id(sku));
      if (sku !== undefined && !item) return err("SKU_NOT_FOUND", `Order ${o.id} has no item ${sku}`);
      const block = refundBlock(o, item?.sku ?? null, clock, state.refunds);
      if (block === "NOT_DELIVERED") return err(block, `Order ${o.id} has not been delivered`);
      if (block === "ALREADY_REFUNDED") return err(block, `Order ${o.id} already has a refund`);
      if (block) return err(block, `Order ${o.id} was delivered more than 30 days ago`);
      const refund = {
        id: `RF-${state.refunds.length + 1}`,
        order_id: o.id,
        sku: item?.sku ?? null,
        reason,
        amount_cents: item ? item.qty * item.unit_price_cents : o.total_cents,
        created_at: clock,
      };
      state.refunds.push(refund);
      return { refund };
    },

    changeShippingAddress(orderId: string, address: Address) {
      const o = findOrder(orderId);
      if (!o) return notFound(orderId);
      if (o.status === "cancelled") return err("ORDER_CANCELLED", `Order ${o.id} is cancelled`);
      if (isShipped(o)) return err("ALREADY_SHIPPED", `Order ${o.id} has already shipped`);
      state.address_changes.push({ order_id: o.id, old_address: o.shipping_address, new_address: address, created_at: clock });
      o.shipping_address = address;
      return { order_id: o.id, shipping_address: address };
    },

    cancelOrder(orderId: string) {
      const o = findOrder(orderId);
      if (!o) return notFound(orderId);
      if (o.status === "cancelled") return err("ORDER_CANCELLED", `Order ${o.id} is already cancelled`);
      if (isShipped(o)) return err("ALREADY_SHIPPED", `Order ${o.id} has already shipped`);
      o.status = "cancelled";
      return { order_id: o.id, status: o.status };
    },

    handoffToHuman(reason: string, summary: string) {
      const handoff = { id: `HO-${state.handoffs.length + 1}`, reason, summary, created_at: clock };
      state.handoffs.push(handoff);
      return { handoff_id: handoff.id, message: "A human agent will take over this conversation." };
    },
  };
}
