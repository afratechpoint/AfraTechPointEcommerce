import { z } from "zod";

/**
 * Validates that a URL uses an explicit safe HTTP(S) scheme (rejects `javascript:`,
 * `data:`, `vbscript:`, `file:`, and protocol-relative spoofing).
 */
export function isSafeHttpUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2048) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Validates either a safe HTTP(S) URL or a clean relative app path (`/shop`, `/logo.png`).
 */
export function isSafeUrlOrRelativePath(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return true; // empty optional field
  if (trimmed.startsWith("/") && !trimmed.startsWith("//") && !trimmed.includes("\\")) {
    return trimmed.length <= 1024;
  }
  return isSafeHttpUrl(trimmed);
}

/**
 * Strips CR/LF and control characters from email headers / subject lines to prevent
 * SMTP header injection.
 */
export function sanitizeHeaderValue(value: string, maxLen = 250): string {
  return String(value || "")
    .replace(/[\r\n\0\x0B\x0C]+/g, " ")
    .trim()
    .slice(0, maxLen);
}

/**
 * Serializes data safely for `<script type="application/ld+json">` so embedded
 * `</script>` or `<!--` sequences can never break out of the script tag.
 */
export function safeJsonLdStringify(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

/**
 * Strict allowlist schema for customer profile updates (`POST /api/profile`).
 * Rejects any unexpected fields such as `role`, `isAdmin`, `uid`, or `email`.
 */
export const profileUpdateSchema = z
  .object({
    displayName: z.string().trim().min(1).max(100).optional(),
    phone: z
      .string()
      .trim()
      .refine((v) => v === "" || /^\d{11}$/.test(v), "Phone number must be 11 digits.")
      .optional(),
    address: z.string().trim().max(300).optional(),
    division: z.string().trim().max(60).optional(),
    district: z.string().trim().max(60).optional(),
    upazila: z.string().trim().max(80).optional(),
    bio: z.string().trim().max(500).optional(),
  })
  .strict();

export const orderItemInputSchema = z.object({
  productId: z.string().trim().min(1).max(128),
  quantity: z.number().int().min(1).max(99),
  variantName: z.string().trim().max(120).nullable().optional(),
  name: z.string().max(300).optional(),
  price: z.number().nonnegative().optional(),
  image: z.string().max(2048).optional(),
  productKind: z.string().max(30).optional(),
  virtualType: z.string().max(30).nullable().optional(),
});

export const shippingAddressSchema = z
  .object({
    fullName: z.string().trim().max(120).optional().default(""),
    phone: z.string().trim().max(20).optional().default(""),
    address: z.string().trim().max(400).optional().default(""),
    city: z.string().trim().max(100).optional().default(""),
    postalCode: z.string().trim().max(20).optional(),
    division: z.string().trim().max(60).optional().default(""),
    district: z.string().trim().max(60).optional().default(""),
    upazila: z.string().trim().max(80).optional().default(""),
  })
  .optional();

export const paymentInputSchema = z.object({
  method: z.string().trim().min(1).max(60),
  senderNumber: z.string().trim().max(20).optional().default(""),
  transactionId: z.string().trim().max(60).optional().default(""),
  accountUsed: z.string().trim().max(40).optional().default(""),
});

export const fulfillmentInputSchema = z
  .object({
    targetUrl: z
      .string()
      .trim()
      .max(2048)
      .refine((v) => !v || isSafeHttpUrl(v), "Target URL must start with http:// or https://")
      .optional(),
    notes: z.string().trim().max(1000).optional(),
    customFields: z
      .array(
        z.object({
          product: z.string().trim().max(200).optional(),
          label: z.string().trim().min(1).max(120),
          value: z.string().trim().max(1000),
        })
      )
      .max(30)
      .optional(),
  })
  .nullable()
  .optional();

export const createOrderInputSchema = z.object({
  items: z.array(orderItemInputSchema).min(1).max(50),
  shippingAddress: shippingAddressSchema,
  payment: paymentInputSchema,
  fulfillment: fulfillmentInputSchema,
  customer: z
    .object({
      name: z.string().trim().max(120).optional(),
      email: z.string().trim().max(200).optional(),
      phone: z.string().trim().max(20).optional(),
      address: z.string().trim().max(400).optional(),
      city: z.string().trim().max(100).optional(),
    })
    .optional(),
});

export const ALLOWED_PAYMENT_STATUSES = [
  "pending",
  "pending_cod",
  "confirmed",
  "cancelled",
  "failed",
  "refunded",
] as const;

export const ALLOWED_ORDER_STATUSES = [
  "pending",
  "processing",
  "shipped",
  "delivered",
  "completed",
  "cancelled",
] as const;

export const deliveryEntrySchema = z.object({
  productId: z.string().trim().max(128),
  itemName: z.string().trim().max(300).optional(),
  variantName: z.string().trim().max(120).nullable().optional(),
  type: z.enum(["account", "license", "software", "social"]),
  value: z
    .string()
    .trim()
    .max(2048)
    .refine(
      (v) => v.length > 0,
      "Delivery value cannot be empty"
    ),
  password: z.string().trim().max(500).optional(),
  note: z.string().trim().max(1000).optional(),
  revealed: z.boolean().optional(),
});

export const patchOrderInputSchema = z
  .object({
    paymentStatus: z.enum(ALLOWED_PAYMENT_STATUSES).optional(),
    orderStatus: z.enum(ALLOWED_ORDER_STATUSES).optional(),
    status: z.string().trim().max(40).optional(),
    cancellationReason: z.string().trim().max(500).optional(),
    trackingNumber: z.string().trim().max(100).optional(),
    courier: z.string().trim().max(60).optional(),
    courierTrackingCode: z.string().trim().max(100).optional(),
    courierStatus: z.string().trim().max(60).optional(),
    deliveries: z.array(deliveryEntrySchema).max(50).optional(),
  })
  .strict();

export const ALLOWED_ROLES = ["admin", "shop_manager", "order_manager", "customer"] as const;
export type AppRole = (typeof ALLOWED_ROLES)[number];

/**
 * Strips unconfirmed digital deliverables (`deliveries`) before returning an order
 * to any non-staff caller.
 */
export function sanitizeOrderForCustomer<T extends Record<string, any>>(order: T): T {
  if (!order || typeof order !== "object") return order;
  const payStatus = String(order.paymentStatus || "pending").toLowerCase();
  const ordStatus = String(order.orderStatus || order.status || "pending").toLowerCase();

  const canRevealDeliveries = payStatus === "confirmed" && ordStatus !== "cancelled";

  if (!canRevealDeliveries && "deliveries" in order) {
    const { deliveries: _omitted, ...safeOrder } = order;
    return safeOrder as T;
  }
  return order;
}
