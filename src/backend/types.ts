import { z } from "zod";

export const AddressSchema = z.object({
  line1: z.string().trim().min(1),
  line2: z.string().optional(),
  city: z.string().trim().min(1),
  postal_code: z.string().trim().min(1),
  country: z.string().trim().min(2),
});

export const OrderItemSchema = z.object({
  sku: z.string(),
  name: z.string(),
  color: z.string().optional(),
  qty: z.number().int().positive(),
  unit_price_cents: z.number().int().nonnegative(),
});

export const CustomerSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
});

export const OrderStatusSchema = z.enum(["pending", "shipped", "delivered", "cancelled"]);

// Fixture orders may omit derived fields; the store fills them in.
export const OrderSchema = z.object({
  id: z.string(),
  customer_id: z.string(),
  status: OrderStatusSchema,
  placed_at: z.string(),
  shipped_at: z.string().nullable().optional(),
  delivered_at: z.string().nullable().optional(),
  shipping_address: AddressSchema,
  items: z.array(OrderItemSchema).min(1),
  total_cents: z.number().int().nonnegative().optional(),
});

export type Address = z.infer<typeof AddressSchema>;
export type OrderItem = z.infer<typeof OrderItemSchema>;
export type Customer = z.infer<typeof CustomerSchema>;
export type OrderStatus = z.infer<typeof OrderStatusSchema>;
export type OrderInput = z.infer<typeof OrderSchema>;
export type Order = Omit<OrderInput, "shipped_at" | "delivered_at" | "total_cents"> & {
  shipped_at: string | null;
  delivered_at: string | null;
  total_cents: number;
};

export type Refund = {
  id: string;
  order_id: string;
  sku: string | null;
  reason: string;
  amount_cents: number;
  created_at: string;
};

export type Handoff = { id: string; reason: string; summary: string; created_at: string };

export type AddressChange = { order_id: string; old_address: Address; new_address: Address; created_at: string };

export type Snapshot = {
  customers: Record<string, Customer>;
  orders: Record<string, Order>;
  refunds: Refund[];
  handoffs: Handoff[];
  address_changes: AddressChange[];
};

export type Fixtures = { customers?: Customer[]; orders?: OrderInput[] };

export type ToolError = { error: { code: string; message: string } };

export const DEFAULT_CLOCK = "2026-06-15T12:00:00Z";
