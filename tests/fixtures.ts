import type { Fixtures } from "../src/backend/types.js";

export const CLOCK = "2026-06-15T12:00:00Z";
const daysBefore = (days: number) => new Date(Date.parse(CLOCK) - days * 86_400_000).toISOString();
const address = { line1: "1 Test Lane", city: "Pune", postal_code: "411001", country: "IN" };

export function order(id: string, status: "pending" | "shipped" | "delivered" | "cancelled", deliveredDaysAgo?: number) {
  return {
    id,
    customer_id: "C900",
    status,
    placed_at: daysBefore(60),
    shipped_at: status === "shipped" || status === "delivered" ? daysBefore(50) : null,
    delivered_at: deliveredDaysAgo === undefined ? null : daysBefore(deliveredDaysAgo),
    shipping_address: address,
    items: [
      { sku: "A-1", name: "Blue mug", qty: 2, unit_price_cents: 1000 },
      { sku: "B-2", name: "Lamp", qty: 1, unit_price_cents: 5000 },
    ],
  };
}

export const FIXTURES: Fixtures = {
  customers: [{ id: "C900", name: "Test Person", email: "test.person@example.com" }],
  orders: [
    order("ORD-30", "delivered", 30),
    order("ORD-31", "delivered", 31),
    order("ORD-PEND", "pending"),
    order("ORD-SHIP", "shipped"),
  ],
};
