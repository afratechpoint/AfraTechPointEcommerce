// lib/firebase/server_firestore.ts
import { adminDb, adminMessaging, getAdminRtDb, adminAuth } from "./admin";
import admin from "firebase-admin";
import {
  getAvailableStock,
  hasPerVariantStock,
  resolveVirtualStockMode,
} from "@/lib/inventory";

export { adminDb, adminMessaging, getAdminRtDb, adminAuth };

const SETTINGS_DOC_ID = "main";
const SETTINGS_COLLECTION = "config";

const RESTRICTED_PROFILE_KEYS = new Set([
  "role",
  "isadmin",
  "uid",
  "email",
  "createdat",
  "customclaims",
  "permissions",
]);

/**
 * Recursively removes `undefined` properties so Firebase Admin SDK never rejects
 * `add()` / `update()` / `set()` calls when optional fields are omitted.
 */
export function stripUndefinedDeep(val: any): any {
  if (val === undefined) return undefined;
  if (val === null || typeof val !== "object") return val;
  if (val instanceof Date) return val;
  if (typeof val.toDate === "function" || typeof val._methodName === "string") return val;
  if (Array.isArray(val)) {
    return val.map((item) => stripUndefinedDeep(item)).filter((item) => item !== undefined);
  }
  const clean: Record<string, any> = {};
  for (const key of Object.keys(val)) {
    const v = stripUndefinedDeep(val[key]);
    if (v !== undefined) {
      clean[key] = v;
    }
  }
  return clean;
}

export function stripRestrictedProfileFields(data: Record<string, any>): Record<string, any> {
  const safe: Record<string, any> = {};
  if (!data || typeof data !== "object") return safe;
  for (const [k, v] of Object.entries(data)) {
    if (!RESTRICTED_PROFILE_KEYS.has(k.toLowerCase())) {
      safe[k] = v;
    }
  }
  return stripUndefinedDeep(safe) || {};
}

// --- Settings ---
export async function getSettingsFromFirestore() {
  const docRef = adminDb.collection(SETTINGS_COLLECTION).doc(SETTINGS_DOC_ID);
  const docSnap = await docRef.get();
  if (docSnap.exists) {
    return docSnap.data();
  }
  return null;
}

export async function updateSettingsInFirestore(data: any) {
  const clean = stripUndefinedDeep(data) || {};
  const docRef = adminDb.collection(SETTINGS_COLLECTION).doc(SETTINGS_DOC_ID);
  await docRef.set(clean, { merge: true });
}

// --- Post-Order Notifications Helper ---
export async function dispatchOrderCreatedNotifications(orderId: string, orderData: any) {
  try {
    const notifRef = adminDb.collection("notifications").doc(`order_${orderId}`);
    const existing = await notifRef.get();
    if (!existing.exists) {
      await notifRef.set({
        type: "new_order",
        title: "New Order Placed",
        message: `New order #${orderId.slice(0, 8).toUpperCase()} - BDT ${orderData.totalAmount || orderData.total || "N/A"} received.`,
        recipient: "admin",
        link: `/admin/orders/${orderId}`,
        isRead: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      sendPushToUser(
        "admin",
        "New Order Placed",
        `Order #${orderId.slice(0, 8).toUpperCase()} received.`,
        `/admin/orders/${orderId}`
      ).catch(() => {});
    }

    if (orderData?.userId) {
      const custNotifRef = adminDb.collection("notifications").doc(`cust_order_${orderId}`);
      const existingCust = await custNotifRef.get();
      if (!existingCust.exists) {
        await custNotifRef.set({
          type: "order_status_update",
          title: "Order Placed Successfully",
          message: `Your order #${orderId.slice(0, 8).toUpperCase()} for BDT ${orderData.totalAmount || orderData.total || "N/A"} has been placed.`,
          recipient: orderData.userId,
          link: `/account/orders/${orderId}`,
          isRead: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        sendPushToUser(
          orderData.userId,
          "Order Placed",
          `Your order #${orderId.slice(0, 8).toUpperCase()} has been placed.`,
          `/account/orders/${orderId}`
        ).catch(() => {});
      }
    }
  } catch (notifErr: any) {
    console.error("[Notification] Failed to create order notification:", notifErr?.message);
  }
}

export class OrderBusinessError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "OrderBusinessError";
    this.statusCode = statusCode;
  }
}

/**
 * Pure deterministic checkout & stock/pool deduction engine shared by both
 * Firestore ACID transactions and local test/fallback atomic locks.
 */
export function computeAtomicOrderCheckout(params: {
  requestedItems: Array<{ productId: string; quantity: number; variantName?: string | null }>;
  productDocsMap: Map<string, any>;
  settings: any;
  userId: string;
  userEmail: string;
  shippingAddress: any;
  payment: { method: string; senderNumber?: string; transactionId?: string; accountUsed?: string };
  fulfillment?: any;
  customer?: any;
}) {
  const {
    requestedItems,
    productDocsMap,
    settings,
    userId,
    userEmail,
    shippingAddress,
    payment,
    fulfillment,
    customer,
  } = params;

  if (!requestedItems.length) {
    throw new OrderBusinessError("Order must contain at least one item.", 400);
  }

  // Clone product records so mutations inside this attempt never taint outer state
  const workingProducts = new Map<string, any>();
  Array.from(productDocsMap.entries()).forEach(([id, rawProd]) => {
    if (rawProd) {
      workingProducts.set(id, JSON.parse(JSON.stringify(rawProd)));
    }
  });

  let calculatedSubtotal = 0;
  let hasPhysical = false;
  let hasVirtual = false;

  const validatedItems = requestedItems.map((item) => {
    const product = workingProducts.get(item.productId);
    if (!product) {
      throw new OrderBusinessError(`Product "${item.productId}" is no longer available.`, 400);
    }

    if (product.published === false || product.active === false || product.isDisabled === true) {
      throw new OrderBusinessError(`"${product.name}" is currently unavailable for purchase.`, 400);
    }

    const quantity = Math.floor(Number(item.quantity));
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > 99) {
      throw new OrderBusinessError("Invalid item quantity.", 400);
    }

    const kind = product.productKind === "virtual" ? "virtual" : "physical";
    if (kind === "physical") hasPhysical = true;
    else hasVirtual = true;

    let unitPrice = Number(product.salePrice ?? product.regularPrice ?? product.price ?? 0);
    let resolvedVariantName: string | null = item.variantName ? item.variantName.trim() : null;

    if (Array.isArray(product.variants) && product.variants.length > 0) {
      if (!resolvedVariantName) {
        throw new OrderBusinessError(`Please select a variant for "${product.name}".`, 400);
      }
      const matchedVariant = product.variants.find(
        (v: any) => String(v?.name || "").trim().toLowerCase() === resolvedVariantName!.toLowerCase()
      );
      if (!matchedVariant) {
        throw new OrderBusinessError(
          `Selected variant "${resolvedVariantName}" does not exist for "${product.name}".`,
          400
        );
      }
      resolvedVariantName = matchedVariant.name;
      if (!matchedVariant.useMainPrice) {
        unitPrice = Number(matchedVariant.salePrice ?? matchedVariant.regularPrice ?? unitPrice);
      }
    } else {
      resolvedVariantName = null;
    }

    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new OrderBusinessError(`Invalid pricing configuration for "${product.name}".`, 400);
    }

    calculatedSubtotal += unitPrice * quantity;

    return {
      productId: product.id,
      name: String(product.name || "Product"),
      price: unitPrice,
      quantity,
      image: product.image || "",
      variantName: resolvedVariantName,
      productKind: kind,
      virtualType: product.virtualType || null,
    };
  });

  // Payment method & COD eligibility enforcement using server settings
  const method = String(payment?.method || "").trim();
  const isCodOrder = method === "Cash on Delivery";

  if (isCodOrder) {
    if (hasVirtual) {
      throw new OrderBusinessError("Digital payment is required for virtual products.", 400);
    }
    if (settings?.codEnabled === false) {
      throw new OrderBusinessError("Cash on Delivery is currently disabled.", 400);
    }
  } else {
    const enabledMethods: any[] = Array.isArray(settings?.paymentMethods)
      ? settings.paymentMethods.filter((m: any) => m && m.enabled !== false)
      : [];
    if (enabledMethods.length > 0) {
      const allowedMethod = enabledMethods.find(
        (m: any) => String(m.name || "").trim().toLowerCase() === method.toLowerCase()
      );
      if (!allowedMethod) {
        throw new OrderBusinessError(`Payment provider "${method}" is not enabled.`, 400);
      }
    }

    const sender = String(payment?.senderNumber || "").trim();
    const trxId = String(payment?.transactionId || "").trim();
    if (!/^01\d{9}$/.test(sender)) {
      throw new OrderBusinessError("Sender number must be a valid 11-digit mobile number.", 400);
    }
    if (!/^[A-Za-z0-9_-]{4,40}$/.test(trxId)) {
      throw new OrderBusinessError(
        "Enter a valid Transaction ID (4–40 alphanumeric characters).",
        400
      );
    }
  }

  if (hasPhysical) {
    const fullName = String(shippingAddress?.fullName || "").trim();
    const phone = String(shippingAddress?.phone || "").trim();
    if (!fullName) {
      throw new OrderBusinessError("Recipient full name is required for physical delivery.", 400);
    }
    if (!/^01\d{9}$/.test(phone)) {
      throw new OrderBusinessError("Shipping phone number must be a valid 11-digit BD number.", 400);
    }
  }

  // Aggregate requested quantities per (productId, variantName) to catch split-line overselling
  const requestedByKey = new Map<string, { product: any; variantName: string | null; qty: number }>();
  for (const vItem of validatedItems) {
    const product = workingProducts.get(vItem.productId)!;
    const key = `${vItem.productId}::${(vItem.variantName || "").toLowerCase()}`;
    const prev = requestedByKey.get(key);
    requestedByKey.set(key, {
      product,
      variantName: vItem.variantName,
      qty: (prev?.qty || 0) + vItem.quantity,
    });
  }

  // Also check product-level total pool capacity when multiple variants share an untagged pool
  const requestedByProductTotal = new Map<string, number>();
  for (const vItem of validatedItems) {
    requestedByProductTotal.set(
      vItem.productId,
      (requestedByProductTotal.get(vItem.productId) || 0) + vItem.quantity
    );
  }

  for (const { product, variantName, qty } of Array.from(requestedByKey.values())) {
    const avail = getAvailableStock(product, variantName);
    if (avail !== null && qty > avail) {
      const label = variantName ? `${product.name} (${variantName})` : product.name;
      throw new OrderBusinessError(
        avail <= 0 ? `"${label}" is Stock Out.` : `Only ${avail} left in stock for "${label}".`,
        400
      );
    }
  }

  for (const [pid, totalQty] of Array.from(requestedByProductTotal.entries())) {
    const product = workingProducts.get(pid)!;
    const totalAvail = getAvailableStock(product, null);
    if (totalAvail !== null && totalQty > totalAvail) {
      throw new OrderBusinessError(
        totalAvail <= 0
          ? `"${product.name}" is Stock Out.`
          : `Only ${totalAvail} total unit(s) left in stock for "${product.name}".`,
        400
      );
    }
  }

  // Deduct stock & allocate pool credentials atomically on the working copies
  const deliveries: any[] = [];
  const dirtyProducts = new Map<string, Record<string, any>>();

  for (const vItem of validatedItems) {
    const product = workingProducts.get(vItem.productId)!;
    const qty = vItem.quantity;

    if (vItem.productKind === "virtual") {
      const cfg = product.virtualConfig || {};
      const vMode = resolveVirtualStockMode(product);

      if (vItem.virtualType === "license" && vMode === "pool" && Array.isArray(cfg.licensePool)) {
        const varLower = (vItem.variantName || "").trim().toLowerCase();
        const sortedPool = [...cfg.licensePool].sort((a: any, b: any) => {
          const aMatch = a.variantName && a.variantName.trim().toLowerCase() === varLower ? 0 : 1;
          const bMatch = b.variantName && b.variantName.trim().toLowerCase() === varLower ? 0 : 1;
          return aMatch - bMatch;
        });
        const eligible = sortedPool.filter(
          (k: any) =>
            k?.key?.trim() &&
            (!vItem.variantName || !k.variantName || k.variantName.trim().toLowerCase() === varLower)
        );
        if (eligible.length < qty) {
          throw new OrderBusinessError(`Insufficient license keys in stock for "${product.name}".`, 400);
        }
        const chosenKeys = eligible.slice(0, qty);
        // Remove exact chosen entries (by id if unique, otherwise by reference index)
        const chosenSet = new Set(chosenKeys);
        const remainingPool = cfg.licensePool.filter((k: any) => {
          if (chosenSet.has(k)) return false;
          if (k?.id && chosenKeys.some((ck: any) => ck?.id && ck.id === k.id)) return false;
          return true;
        });

        product.virtualConfig = { ...cfg, stockMode: "pool", licensePool: remainingPool };
        product.stock = remainingPool.length;
        dirtyProducts.set(product.id, {
          stock: product.stock,
          virtualConfig: product.virtualConfig,
        });

        deliveries.push({
          productId: vItem.productId,
          itemName: vItem.name,
          variantName: vItem.variantName,
          type: "license",
          value: chosenKeys.map((k: any) => k.key).filter(Boolean).join(" | "),
          note: chosenKeys.map((k: any) => k.note).filter(Boolean).join(" · ") || "",
          revealed: false,
        });
      } else if (
        vItem.virtualType === "account" &&
        vMode === "pool" &&
        Array.isArray(cfg.credentialPool)
      ) {
        const varLower = (vItem.variantName || "").trim().toLowerCase();
        const sortedPool = [...cfg.credentialPool].sort((a: any, b: any) => {
          const aMatch = a.variantName && a.variantName.trim().toLowerCase() === varLower ? 0 : 1;
          const bMatch = b.variantName && b.variantName.trim().toLowerCase() === varLower ? 0 : 1;
          return aMatch - bMatch;
        });
        const eligible = sortedPool.filter(
          (c: any) =>
            c?.email?.trim() &&
            c?.password?.trim() &&
            (!vItem.variantName || !c.variantName || c.variantName.trim().toLowerCase() === varLower)
        );
        if (eligible.length < qty) {
          throw new OrderBusinessError(`Insufficient accounts in stock for "${product.name}".`, 400);
        }
        const chosenCreds = eligible.slice(0, qty);
        const chosenSet = new Set(chosenCreds);
        const remainingPool = cfg.credentialPool.filter((c: any) => {
          if (chosenSet.has(c)) return false;
          if (c?.id && chosenCreds.some((cc: any) => cc?.id && cc.id === c.id)) return false;
          return true;
        });

        product.virtualConfig = { ...cfg, stockMode: "pool", credentialPool: remainingPool };
        product.stock = remainingPool.length;
        dirtyProducts.set(product.id, {
          stock: product.stock,
          virtualConfig: product.virtualConfig,
        });

        chosenCreds.forEach((cred: any) => {
          deliveries.push({
            productId: vItem.productId,
            itemName: vItem.name,
            variantName: vItem.variantName,
            type: "account",
            value: cred.email,
            password: cred.password,
            note: cred.note || "",
            revealed: false,
          });
        });
      } else if (vMode === "quantity") {
        if (hasPerVariantStock(product) && vItem.variantName) {
          product.variants = product.variants.map((vr: any) => {
            if (
              vr.name.trim().toLowerCase() === vItem.variantName!.trim().toLowerCase() &&
              vr.stock !== undefined &&
              vr.stock !== null
            ) {
              if (Number(vr.stock) < qty) {
                throw new OrderBusinessError(`"${product.name} (${vr.name})" is Stock Out.`, 400);
              }
              return { ...vr, stock: Number(vr.stock) - qty };
            }
            return vr;
          });
          product.stock = product.variants.reduce(
            (s: number, vr: any) => s + (Number(vr.stock) || 0),
            0
          );
          dirtyProducts.set(product.id, {
            stock: product.stock,
            variants: product.variants,
          });
        } else if (product.stock !== undefined && product.stock !== null) {
          if (Number(product.stock) < qty) {
            throw new OrderBusinessError(`"${product.name}" is Stock Out.`, 400);
          }
          product.stock = Number(product.stock) - qty;
          dirtyProducts.set(product.id, { stock: product.stock });
        }
      }

      if (vItem.virtualType === "software" && cfg.downloadUrl) {
        deliveries.push({
          productId: vItem.productId,
          itemName: vItem.name,
          variantName: vItem.variantName,
          type: "software",
          value: cfg.downloadUrl,
          note: [cfg.version, cfg.fileSize].filter(Boolean).join(" · ") || "",
          revealed: false,
        });
      }
    } else {
      // Physical product stock deduction
      if (hasPerVariantStock(product) && vItem.variantName) {
        product.variants = product.variants.map((vr: any) => {
          if (
            vr.name.trim().toLowerCase() === vItem.variantName!.trim().toLowerCase() &&
            vr.stock !== undefined &&
            vr.stock !== null
          ) {
            if (Number(vr.stock) < qty) {
              throw new OrderBusinessError(`"${product.name} (${vr.name})" is Stock Out.`, 400);
            }
            return { ...vr, stock: Number(vr.stock) - qty };
          }
          return vr;
        });
        const allTracked = product.variants.every(
          (vr: any) => vr.stock !== undefined && vr.stock !== null
        );
        if (allTracked) {
          product.stock = product.variants.reduce(
            (s: number, vr: any) => s + (Number(vr.stock) || 0),
            0
          );
        }
        dirtyProducts.set(product.id, {
          ...(allTracked ? { stock: product.stock } : {}),
          variants: product.variants,
        });
      } else if (product.stock !== undefined && product.stock !== null) {
        if (Number(product.stock) < qty) {
          throw new OrderBusinessError(`"${product.name}" is Stock Out.`, 400);
        }
        product.stock = Number(product.stock) - qty;
        dirtyProducts.set(product.id, { stock: product.stock });
      }
    }
  }

  const deliveryCharge = hasPhysical ? Math.max(0, Number(settings?.deliveryCharge) || 0) : 0;
  const calculatedTotal = calculatedSubtotal + deliveryCharge;

  const normalizedTrxKey = !isCodOrder
    ? String(payment.transactionId || "")
        .trim()
        .toUpperCase()
    : null;

  const cleanPayment = isCodOrder
    ? {
        method: "Cash on Delivery",
        senderNumber: "",
        transactionId: "",
        accountUsed: "",
      }
    : {
        method,
        senderNumber: String(payment.senderNumber || "").trim(),
        transactionId: String(payment.transactionId || "").trim(),
        accountUsed: String(payment.accountUsed || "").trim(),
      };

  // Trusted server-controlled initial statuses ONLY — client cannot forge `confirmed` or `delivered`
  const orderRecord = stripUndefinedDeep({
    userId,
    userEmail,
    items: validatedItems,
    shippingAddress: shippingAddress || {},
    customer: customer
      ? {
          name: customer.name || shippingAddress?.fullName || "",
          email: userEmail,
          phone: customer.phone || shippingAddress?.phone || "",
          address: customer.address || shippingAddress?.address || "",
          city: customer.city || shippingAddress?.city || "",
        }
      : undefined,
    payment: cleanPayment,
    paymentMethod: cleanPayment.method,
    subtotal: calculatedSubtotal,
    deliveryCharge,
    discount: 0,
    total: calculatedTotal,
    totalAmount: calculatedTotal,
    hasPhysical,
    hasVirtual,
    stockDeducted: true,
    stockRestored: false,
    fulfillment: fulfillment || null,
    deliveries,
    paymentStatus: isCodOrder ? "pending_cod" : "pending",
    orderStatus: "pending",
    status: "Pending",
  });

  return {
    orderRecord,
    dirtyProducts,
    normalizedTrxKey,
  };
}

/**
 * Atomically validates inventory, reserves mobile-banking Transaction IDs against reuse,
 * deducts physical/virtual stock & credential pools, and creates the order inside a
 * single Firestore ACID transaction.
 */
export async function placeOrderTransactionInFirestore(params: {
  requestedItems: Array<{ productId: string; quantity: number; variantName?: string | null }>;
  settings: any;
  userId: string;
  userEmail: string;
  shippingAddress: any;
  payment: { method: string; senderNumber?: string; transactionId?: string; accountUsed?: string };
  fulfillment?: any;
  customer?: any;
}) {
  const uniqueProductIds = Array.from(new Set(params.requestedItems.map((i) => i.productId)));
  const newOrderRef = adminDb.collection("orders").doc();

  const createdOrder = await adminDb.runTransaction(async (tx: any) => {
    // 1. Read all product docs + optional TrxID lock doc FIRST (Firestore transactions require all reads before writes)
    const prodRefs = uniqueProductIds.map((pid) => adminDb.collection("products").doc(pid));
    const prodSnaps = await Promise.all(prodRefs.map((ref) => tx.get(ref)));

    const productDocsMap = new Map<string, any>();
    prodSnaps.forEach((snap: any, idx: number) => {
      if (snap.exists) {
        productDocsMap.set(uniqueProductIds[idx], { id: snap.id, ...snap.data() });
      }
    });

    const isCodOrder = String(params.payment?.method || "").trim() === "Cash on Delivery";
    const candidateTrxKey = !isCodOrder
      ? String(params.payment?.transactionId || "")
          .trim()
          .toUpperCase()
      : "";
    const trxRef =
      candidateTrxKey && /^[A-Za-z0-9_-]{4,40}$/.test(candidateTrxKey)
        ? adminDb.collection("used_transactions").doc(candidateTrxKey)
        : null;
    const trxSnap = trxRef ? await tx.get(trxRef) : null;

    if (trxSnap?.exists) {
      throw new OrderBusinessError(
        "This Transaction ID (TrxID) has already been submitted for another order.",
        409
      );
    }

    // 2. Run deterministic validation, pricing, stock & pool allocation
    const { orderRecord, dirtyProducts, normalizedTrxKey } = computeAtomicOrderCheckout({
      ...params,
      productDocsMap,
    });

    // 3. Persist TrxID reservation, product stock/pool updates, and new order atomically
    if (trxRef && normalizedTrxKey) {
      tx.set(trxRef, {
        transactionId: normalizedTrxKey,
        method: orderRecord.payment.method,
        senderNumber: orderRecord.payment.senderNumber,
        orderId: newOrderRef.id,
        userId: params.userId,
        amount: orderRecord.totalAmount,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    for (const [pid, patch] of Array.from(dirtyProducts.entries())) {
      const pRef = adminDb.collection("products").doc(pid);
      tx.update(pRef, {
        ...stripUndefinedDeep(patch),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    tx.set(newOrderRef, {
      ...orderRecord,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {
      id: newOrderRef.id,
      ...orderRecord,
      createdAt: new Date().toISOString(),
    };
  });

  // Non-blocking notifications after commit
  dispatchOrderCreatedNotifications(createdOrder.id, createdOrder).catch(() => {});

  return createdOrder;
}

/**
 * Atomically restores physical/quantity stock and unrevealed digital pool items
 * inside a Firestore transaction, ensuring duplicate cancel requests can NEVER
 * restore stock or duplicate license keys twice.
 */
export async function restoreCancelledOrderStockInFirestore(orderId: string): Promise<boolean> {
  const orderRef = adminDb.collection("orders").doc(orderId);

  return await adminDb.runTransaction(async (tx: any) => {
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists) return false;
    const order = orderSnap.data() || {};

    if (order.stockRestored) {
      return false; // Already restored — idempotent no-op
    }

    const productIds = new Set<string>();
    if (Array.isArray(order.items)) {
      order.items.forEach((it: any) => {
        if (it?.productId) productIds.add(it.productId);
      });
    }
    if (Array.isArray(order.deliveries)) {
      order.deliveries.forEach((d: any) => {
        if (d?.productId) productIds.add(d.productId);
      });
    }

    const pidList = Array.from(productIds);
    const prodSnaps = await Promise.all(
      pidList.map((pid) => tx.get(adminDb.collection("products").doc(pid)))
    );
    const prodMap = new Map<string, any>();
    prodSnaps.forEach((s: any, idx: number) => {
      if (s.exists) prodMap.set(pidList[idx], JSON.parse(JSON.stringify({ id: s.id, ...s.data() })));
    });

    const dirtyProds = new Set<string>();

    // 1. Return unrevealed pre-reserved License Keys & Account Credentials ONLY if never paid/revealed
    if (order.paymentStatus !== "confirmed" && order.paymentStatus !== "refunded" && Array.isArray(order.deliveries)) {
      for (const d of order.deliveries) {
        if (!d?.productId || d.revealed) continue;
        const prod = prodMap.get(d.productId);
        if (!prod) continue;
        const cfg = prod.virtualConfig || {};

        if (d.type === "license" && d.value) {
          const existingKeys = new Set(
            (cfg.licensePool || []).map((k: any) => String(k?.key || "").trim())
          );
          const restoredKeys = String(d.value)
            .split("|")
            .map((k: string) => k.trim())
            .filter((k: string) => k && !existingKeys.has(k))
            .map((key: string, idx: number) => ({
              id: `restored_${orderId}_${idx}`,
              key,
              ...(d.note ? { note: d.note } : {}),
              ...(d.variantName ? { variantName: d.variantName } : {}),
            }));
          if (restoredKeys.length > 0) {
            const nextPool = [...restoredKeys, ...(cfg.licensePool || [])];
            prod.virtualConfig = { ...cfg, licensePool: nextPool };
            if (resolveVirtualStockMode(prod) === "pool") {
              prod.stock = nextPool.length;
            }
            dirtyProds.add(prod.id);
          }
        } else if (d.type === "account" && d.value && d.password) {
          const emailClean = String(d.value).trim();
          const passClean = String(d.password).trim();
          const alreadyExists = (cfg.credentialPool || []).some(
            (c: any) =>
              String(c?.email || "").trim() === emailClean &&
              String(c?.password || "").trim() === passClean
          );
          if (!alreadyExists) {
            const nextPool = [
              {
                id: `restored_acc_${orderId}_${Date.now()}`,
                email: emailClean,
                password: passClean,
                ...(d.note ? { note: d.note } : {}),
                ...(d.variantName ? { variantName: d.variantName } : {}),
              },
              ...(cfg.credentialPool || []),
            ];
            prod.virtualConfig = { ...cfg, credentialPool: nextPool };
            if (resolveVirtualStockMode(prod) === "pool") {
              prod.stock = nextPool.length;
            }
            dirtyProds.add(prod.id);
          }
        }
      }
    }

    // 2. Restore numeric stock for Physical & Virtual Quantity-mode items
    if (order.stockDeducted && Array.isArray(order.items)) {
      for (const item of order.items) {
        if (!item?.productId) continue;
        const prod = prodMap.get(item.productId);
        if (!prod) continue;
        const qty = Math.max(1, Math.floor(Number(item.quantity) || 1));

        if (prod.productKind === "virtual" && resolveVirtualStockMode(prod) !== "quantity") {
          continue;
        }

        if (hasPerVariantStock(prod) && item.variantName && Array.isArray(prod.variants)) {
          prod.variants = prod.variants.map((vr: any) =>
            vr.name.trim().toLowerCase() === String(item.variantName).trim().toLowerCase() &&
            vr.stock !== undefined &&
            vr.stock !== null
              ? { ...vr, stock: Math.max(0, Number(vr.stock) + qty) }
              : vr
          );
          const allTracked = prod.variants.every(
            (vr: any) => vr.stock !== undefined && vr.stock !== null
          );
          if (allTracked) {
            prod.stock = prod.variants.reduce(
              (s: number, vr: any) => s + (Number(vr.stock) || 0),
              0
            );
          }
          dirtyProds.add(prod.id);
        } else if (prod.stock !== undefined && prod.stock !== null) {
          prod.stock = Math.max(0, Number(prod.stock) + qty);
          dirtyProds.add(prod.id);
        }
      }
    }

    for (const pid of Array.from(dirtyProds)) {
      const prod = prodMap.get(pid);
      if (prod) {
        tx.update(adminDb.collection("products").doc(pid), {
          ...stripUndefinedDeep({
            stock: prod.stock,
            ...(prod.variants ? { variants: prod.variants } : {}),
            ...(prod.virtualConfig ? { virtualConfig: prod.virtualConfig } : {}),
          }),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    }

    tx.update(orderRef, {
      stockRestored: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return true;
  });
}

// --- Orders ---
export async function createOrderInFirestore(orderData: any) {
  const ordersRef = adminDb.collection("orders");
  const docRef = await ordersRef.add({
    ...stripUndefinedDeep(orderData),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await dispatchOrderCreatedNotifications(docRef.id, orderData);

  return {
    id: docRef.id,
    ...orderData,
    createdAt: new Date().toISOString(),
  };
}

export async function getOrderById(orderId: string) {
  const docRef = adminDb.collection("orders").doc(orderId);
  const docSnap = await docRef.get();
  if (!docSnap.exists) return null;
  const data = docSnap.data();
  return {
    id: docSnap.id,
    ...data,
    createdAt: data?.createdAt?.toDate ? data.createdAt.toDate() : data?.createdAt || new Date(),
    updatedAt: data?.updatedAt?.toDate ? data.updatedAt.toDate() : data?.updatedAt || new Date(),
  };
}

export async function getOrdersByUser(userId: string) {
  const q = adminDb.collection("orders").where("userId", "==", userId);
  const snap = await q.get();
  const orders = snap.docs.map((d: any) => {
    const data = d.data();
    return {
      id: d.id,
      ...data,
      createdAt: data?.createdAt?.toDate ? data.createdAt.toDate() : data?.createdAt || new Date(),
      updatedAt: data?.updatedAt?.toDate ? data.updatedAt.toDate() : data?.updatedAt || new Date(),
    };
  });

  return orders.sort(
    (a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export async function getOrderByConsignmentId(consignmentId: number | string) {
  const q = adminDb.collection("orders").where("courierConsignmentId", "==", Number(consignmentId));
  const snap = await q.get();
  if (snap.empty) {
    const q2 = adminDb
      .collection("orders")
      .where("courierConsignmentId", "==", String(consignmentId));
    const snap2 = await q2.get();
    if (snap2.empty) return null;
    const d = snap2.docs[0];
    return { id: d.id, ...d.data() };
  }
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

export async function getAllOrders() {
  const q = adminDb.collection("orders").orderBy("createdAt", "desc");
  const snap = await q.get();
  return snap.docs.map((d: any) => {
    const data = d.data();
    return {
      id: d.id,
      ...data,
      createdAt: data?.createdAt?.toDate ? data.createdAt.toDate() : data?.createdAt || new Date(),
      updatedAt: data?.updatedAt?.toDate ? data.updatedAt.toDate() : data?.updatedAt || new Date(),
    };
  });
}

export async function updateOrderInFirestore(orderId: string, fields: any) {
  const cleanFields = stripUndefinedDeep(fields) || {};
  delete cleanFields.id;
  delete cleanFields.createdAt;
  const docRef = adminDb.collection("orders").doc(orderId);
  await docRef.update({
    ...cleanFields,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  if (fields.orderStatus || fields.status) {
    const newStatus = fields.orderStatus || fields.status;
    try {
      const snap = await docRef.get();
      const order = snap.data();
      if (order?.userId) {
        const isVirt =
          order.hasPhysical === false ||
          (Array.isArray(order.items) &&
            order.items.length > 0 &&
            order.items.every((it: any) => it.productKind === "virtual"));
        const rawSt = String(newStatus).toLowerCase();
        const prettyStatus =
          rawSt === "delivered" || rawSt === "completed"
            ? isVirt
              ? "Completed"
              : "Delivered"
            : rawSt === "processing"
            ? isVirt
              ? "In Progress"
              : "Processing"
            : rawSt.charAt(0).toUpperCase() + rawSt.slice(1);

        const cancelReason =
          rawSt === "cancelled"
            ? String(fields.cancellationReason ?? order.cancellationReason ?? "").trim()
            : "";

        await createNotificationInFirestore({
          type: "order_status_update",
          title: rawSt === "cancelled" ? "Order Cancelled" : "Order Update",
          message:
            rawSt === "cancelled" && cancelReason
              ? `Your order #${orderId.slice(0, 8).toUpperCase()} was cancelled. Reason: ${cancelReason}`
              : `Your order #${orderId.slice(0, 8).toUpperCase()} status is now ${prettyStatus}.`,
          recipient: order.userId,
          link: `/account/orders/${orderId}`,
        });
      }
    } catch (notifErr: any) {
      console.error("[Notification] Failed to create status notification:", notifErr?.message);
    }
  }

  if (fields.paymentStatus === "confirmed" || fields.paymentStatus === "paid") {
    try {
      const snap = await docRef.get();
      const order = snap.data();
      if (order?.userId) {
        await createNotificationInFirestore({
          type: "payment_received",
          title: "Payment Confirmed",
          message: `Your payment for order #${orderId.slice(0, 8).toUpperCase()} has been confirmed.`,
          recipient: order.userId,
          link: `/account/orders/${orderId}`,
        });
      }
    } catch (notifErr: any) {
      console.error("[Notification] Failed to create payment notification:", notifErr?.message);
    }
  } else if (fields.paymentStatus === "refunded") {
    try {
      const snap = await docRef.get();
      const order = snap.data();
      if (order?.userId) {
        await createNotificationInFirestore({
          type: "order_status_update",
          title: "Payment Refunded",
          message: `Your payment for order #${orderId.slice(0, 8).toUpperCase()} has been refunded.`,
          recipient: order.userId,
          link: `/account/orders/${orderId}`,
        });
      }
    } catch (notifErr: any) {
      console.error("[Notification] Failed to create refund notification:", notifErr?.message);
    }
  }
}

export async function getPendingOrdersCount() {
  const q = adminDb.collection("orders").where("orderStatus", "==", "pending");
  const snap = await q.get();
  return snap.size;
}

// --- Products ---
export async function getProductsFromFirestore() {
  const q = adminDb.collection("products").orderBy("createdAt", "desc");
  const snap = await q.get();
  return snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
}

export async function createProductInFirestore(data: any) {
  const cleanData = stripUndefinedDeep(data) || {};
  delete cleanData.id;
  const docRef = await adminDb.collection("products").add({
    ...cleanData,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return {
    id: docRef.id,
    ...cleanData,
    createdAt: new Date().toISOString(),
  };
}

export async function updateProductInFirestore(id: string, data: any) {
  const cleanData = stripUndefinedDeep(data) || {};
  delete cleanData.id;
  delete cleanData.createdAt;
  const docRef = adminDb.collection("products").doc(id);
  await docRef.update({
    ...cleanData,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

export async function deleteProductFromFirestore(id: string) {
  await adminDb.collection("products").doc(id).delete();
}

// ── TRAFFIC STATS ──
export async function incrementTrafficCount() {
  const docRef = adminDb.collection("stats").doc("global");
  const doc = await docRef.get();

  if (!doc.exists) {
    await docRef.set({ trafficCount: 1 });
  } else {
    await docRef.update({
      trafficCount: admin.firestore.FieldValue.increment(1),
    });
  }
}

export async function getTrafficCount(): Promise<number> {
  const doc = await adminDb.collection("stats").doc("global").get();
  return doc.exists ? doc.data()?.trafficCount || 0 : 0;
}

export async function deleteOrderFromFirestore(id: string) {
  await adminDb.collection("orders").doc(id).delete();
}

// --- Notifications ---
export async function createNotificationInFirestore(notif: any) {
  const ref = adminDb.collection("notifications");
  await ref.add({
    ...notif,
    isRead: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  sendPushToUser(notif.recipient, notif.title, notif.message, notif.link).catch(() => {});
}

export async function getNotificationById(id: string) {
  const snap = await adminDb.collection("notifications").doc(id).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

export async function getNotifications(recipient: string = "admin", limit: number = 20) {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 20)));
  const q = adminDb.collection("notifications").where("recipient", "==", recipient);
  const snap = await q.get();
  const list = snap.docs.map((d: any) => {
    const data = d.data();
    return {
      id: d.id,
      ...data,
      createdAt: data.createdAt?.toDate
        ? data.createdAt.toDate().toISOString()
        : data.createdAt
        ? new Date(data.createdAt).toISOString()
        : new Date().toISOString(),
    };
  });
  list.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return list.slice(0, safeLimit);
}

export async function markNotificationAsRead(id: string) {
  const docRef = adminDb.collection("notifications").doc(id);
  const snap = await docRef.get();
  if (!snap.exists) return;
  await docRef.update({ isRead: true });
}

export async function markAllNotificationsAsRead(recipient: string = "admin") {
  const q = adminDb
    .collection("notifications")
    .where("recipient", "==", recipient)
    .where("isRead", "==", false);

  const snap = await q.get();
  if (snap.empty) return;

  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += 400) {
    const chunk = docs.slice(i, i + 400);
    const batch = adminDb.batch();
    chunk.forEach((d: any) => batch.update(d.ref, { isRead: true }));
    await batch.commit();
  }
}

export async function deleteNotification(id: string) {
  await adminDb.collection("notifications").doc(id).delete();
}

export async function clearAllNotifications(recipient: string = "admin") {
  const q = adminDb.collection("notifications").where("recipient", "==", recipient);
  const snap = await q.get();
  if (snap.empty) return;

  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += 400) {
    const chunk = docs.slice(i, i + 400);
    const batch = adminDb.batch();
    chunk.forEach((d: any) => batch.delete(d.ref));
    await batch.commit();
  }
}

// --- Web Push Tokens ---
export async function savePushTokenInFirestore(uid: string, token: string) {
  const docId = `${uid}_${Buffer.from(token).toString("base64url").slice(0, 100)}`;
  const ref = adminDb.collection("push_tokens").doc(docId);
  await ref.set({
    uid,
    token,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

export async function deletePushTokenInFirestore(uid: string, token: string, isStaff = false) {
  const snap = await adminDb.collection("push_tokens").where("token", "==", token).get();
  if (snap.empty) return;
  const batch = adminDb.batch();
  snap.docs.forEach((d: any) => {
    const data = d.data();
    if (data?.uid === uid || (isStaff && data?.uid === "admin")) {
      batch.delete(d.ref);
    }
  });
  await batch.commit();
}

export async function sendPushToUser(uid: string, title: string, body: string, link?: string) {
  const q = adminDb.collection("push_tokens").where("uid", "==", uid);
  const snap = await q.get();
  const tokenDocs = snap.docs.map((d: any) => ({
    docId: d.id,
    token: d.data()?.token || d.id,
  }));
  const tokens = Array.from(new Set(tokenDocs.map((t: any) => t.token).filter(Boolean))) as string[];

  if (tokens.length === 0) {
    return { success: true, tokensFound: 0 };
  }

  const safeLink = typeof link === "string" && link.startsWith("/") ? link : "/";
  const message = {
    notification: { title, body },
    data: { url: safeLink },
    tokens,
  };

  try {
    const response = await adminMessaging.sendEachForMulticast(message);

    if (response.failureCount > 0) {
      const deadTokens = new Set<string>();
      response.responses.forEach((resp: any, idx: number) => {
        if (!resp.success && resp.error?.code?.includes("registration-token-not-registered")) {
          deadTokens.add(tokens[idx]);
        }
      });

      if (deadTokens.size > 0) {
        const batch = adminDb.batch();
        tokenDocs.forEach((td: any) => {
          if (deadTokens.has(td.token)) {
            batch.delete(adminDb.collection("push_tokens").doc(td.docId));
          }
        });
        await batch.commit();
      }
    }
    return {
      success: true,
      tokensFound: tokens.length,
      sentCount: response.successCount,
      failCount: response.failureCount,
    };
  } catch (error: any) {
    console.error("[FCM] Error sending multicast:", error?.message);
    return { success: false, error: "Push delivery error" };
  }
}

// --- User Profiles ---
export async function getUserProfileFromFirestore(uid: string) {
  const docRef = adminDb.collection("users").doc(uid);
  const docSnap = await docRef.get();
  if (docSnap.exists) {
    return docSnap.data();
  }
  return null;
}

export async function getCustomersCountInFirestore() {
  const q = adminDb.collection("users").where("role", "==", "customer");
  const snap = await q.count().get();
  return snap.data().count;
}

export async function updateUserProfileInFirestore(uid: string, data: any) {
  const safeData = stripRestrictedProfileFields(data);
  const docRef = adminDb.collection("users").doc(uid);
  await docRef.set(
    {
      ...safeData,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

// --- Realtime Database (RTDB) Fallback ---
export async function updateUserProfileInRTDB(uid: string, data: any) {
  try {
    const safeData = stripRestrictedProfileFields(data);
    const adminRtDb = getAdminRtDb();
    const ref = adminRtDb.ref(`profiles/${uid}`);
    await ref.update({
      ...safeData,
      updatedAt: new Date().toISOString(),
    });
  } catch {}
}

export async function getUserProfileFromRTDB(uid: string) {
  try {
    const adminRtDb = getAdminRtDb();
    const ref = adminRtDb.ref(`profiles/${uid}`);
    const snap = await ref.get();
    return snap.exists() ? snap.val() : null;
  } catch {
    return null;
  }
}

// --- Fraud Checks Caching ---
export async function getFraudCheckFromFirestore(phone: string) {
  const docRef = adminDb.collection("fraud_checks").doc(phone);
  const docSnap = await docRef.get();
  if (docSnap.exists) {
    const data = docSnap.data();
    return {
      ...data,
      lastChecked: data?.lastChecked?.toDate() || new Date(0),
    };
  }
  return null;
}

export async function saveFraudCheckInFirestore(phone: string, data: any) {
  const docRef = adminDb.collection("fraud_checks").doc(phone);
  await docRef.set({
    ...data,
    lastChecked: admin.firestore.FieldValue.serverTimestamp(),
  });
}
