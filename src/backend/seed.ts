import type { Customer, Order, OrderStatus } from "./types.js";

// mulberry32: tiny, fast and good enough for fixture data.
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ["Aarav", "Maya", "Liam", "Sofia", "Kenji", "Amara", "Lucas", "Zara", "Omar", "Elena"];
const LAST = ["Iyer", "Okafor", "Novak", "Haddad", "Tanaka", "Silva", "Brennan", "Kowalski", "Mehta", "Larsen"];
const CITIES = [
  ["Pune", "411001", "IN"],
  ["Austin", "73301", "US"],
  ["Leeds", "LS1 4AP", "GB"],
  ["Lyon", "69001", "FR"],
  ["Toronto", "M5V 2T6", "CA"],
] as const;
const PRODUCTS = [
  ["MUG-01", "Ceramic mug", 1299],
  ["TEE-02", "Cotton t-shirt", 2499],
  ["LAMP-03", "Desk lamp", 4599],
  ["BAG-04", "Canvas backpack", 6999],
  ["KBD-05", "Mechanical keyboard", 11999],
  ["BOT-06", "Steel water bottle", 1899],
] as const;
const DAY = 86_400_000;

export function createBaseData(seed: number, clock: string): { customers: Customer[]; orders: Order[] } {
  const rand = createRng(seed);
  const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
  const pick = <T>(xs: readonly T[]): T => xs[int(0, xs.length - 1)]!;
  const now = Date.parse(clock);
  const iso = (ms: number) => new Date(ms).toISOString();

  const customers: Customer[] = Array.from({ length: 20 }, (_, i) => {
    const first = pick(FIRST);
    const last = pick(LAST);
    const id = `C${String(i + 1).padStart(3, "0")}`;
    return { id, name: `${first} ${last}`, email: `${first}.${last}${i + 1}@example.net`.toLowerCase() };
  });

  const statuses: OrderStatus[] = ["pending", "shipped", "delivered", "delivered", "cancelled"];
  const orders: Order[] = Array.from({ length: 60 }, (_, i) => {
    const status = pick(statuses);
    const daysAgo = status === "pending" ? int(0, 2) : status === "shipped" ? int(2, 6) : int(10, 90);
    const placed = now - daysAgo * DAY - int(0, 23) * 3_600_000;
    const shipped = status === "shipped" || status === "delivered" ? placed + int(1, 2) * DAY : null;
    const delivered = status === "delivered" && shipped !== null ? shipped + int(2, 5) * DAY : null;
    const [city, postal_code, country] = pick(CITIES);
    const items = Array.from({ length: int(1, 3) }, () => {
      const [sku, name, unit_price_cents] = pick(PRODUCTS);
      return { sku, name, qty: int(1, 2), unit_price_cents };
    });
    return {
      id: `ORD-${5001 + i}`,
      customer_id: pick(customers).id,
      status,
      placed_at: iso(placed),
      shipped_at: shipped === null ? null : iso(shipped),
      delivered_at: delivered === null ? null : iso(delivered),
      shipping_address: { line1: `${int(1, 200)} Market Street`, city, postal_code, country },
      items,
      total_cents: items.reduce((sum, it) => sum + it.qty * it.unit_price_cents, 0),
    };
  });
  return { customers, orders };
}
