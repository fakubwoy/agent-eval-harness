import type { Order, Refund } from "./types.js";

export const REFUND_WINDOW_DAYS = 30;
const DAY = 86_400_000;

export function isShipped(order: Order): boolean {
  return order.status === "shipped" || order.status === "delivered";
}

// Exactly 30 days after delivery is still inside the window; anything later is not.
export function refundWindowExpired(order: Order, clock: string): boolean {
  if (!order.delivered_at) return false;
  return Date.parse(clock) - Date.parse(order.delivered_at) > REFUND_WINDOW_DAYS * DAY;
}

export function alreadyRefunded(orderId: string, sku: string | null, refunds: Refund[]): boolean {
  return refunds.some((r) => r.order_id === orderId && (r.sku === null || sku === null || r.sku === sku));
}

export function refundBlock(order: Order, sku: string | null, clock: string, refunds: Refund[]): string | null {
  if (order.status !== "delivered" || !order.delivered_at) return "NOT_DELIVERED";
  if (alreadyRefunded(order.id, sku, refunds)) return "ALREADY_REFUNDED";
  if (refundWindowExpired(order, clock)) return "REFUND_WINDOW_EXPIRED";
  return null;
}
