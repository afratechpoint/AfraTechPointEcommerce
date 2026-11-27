import { cache } from "react";
import { readData, writeData, settingsFile, productsFile, ordersFile, profilesFile } from "./db";
import path from "path";
import crypto from "crypto";
import { FALLBACK_PRODUCTS, FALLBACK_SETTINGS, FALLBACK_ORDERS } from "./fallback_constants";
import { emitRealtime, onRealtimeCacheInvalidate, ensureFirestoreWatchers } from "./realtime-bus";
import {
  computeAtomicOrderCheckout,
  OrderBusinessError,
  stripRestrictedProfileFields,
} from "./firebase/server_firestore";
import { hasPerVariantStock, resolveVirtualStockMode } from "./inventory";

function isFirebaseEnabled(): boolean {
  return process.env.NEXT_PUBLIC_USE_FIREBASE === "true";
}

interface StorageMemoryCache {
  settings?: any;
  settingsFetchedAt: number;
  products?: any[];
  productsFetchedAt: number;
  deletedProductIds: Set<string>;
  deletedOrderIds: Set<string>;
}

const gCache = globalThis as unknown as {
  __afraStorageCache?: StorageMemoryCache;
  __afraOrderMutex?: Promise<void>;
};
if (!gCache.__afraStorageCache) {
  gCache.__afraStorageCache = {
    settingsFetchedAt: 0,
    productsFetchedAt: 0,
    deletedProductIds: new Set(),
    deletedOrderIds: new Set(),
  };
}
const memoryCache = gCache.__afraStorageCache;
const CACHE_TTL = 30 * 1000;

/**
 * Serializes local-JSON order/inventory transactions when running offline or in
 * automated security tests (`NEXT_PUBLIC_USE_FIREBASE !== "true"`), matching
 * Firestore's serializable transaction guarantees.
 */
async function withLocalOrderLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = gCache.__afraOrderMutex || Promise.resolve();
  let release!: () => void;
  gCache.__afraOrderMutex = new Promise<void>((res) => {
    release = res;
  });
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

onRealtimeCacheInvalidate((topic) => {
  if (topic === "settings") {
    memoryCache.settings = undefined;
    memoryCache.settingsFetchedAt = 0;
  } else if (topic === "products") {
    memoryCache.products = undefined;
    memoryCache.productsFetchedAt = 0;
  }
});

ensureFirestoreWatchers();

const getAdapter = async () => {
  return await import("./firebase/server_firestore");
};

export const storage = {
  // ── Settings ──────────────────────────────────────────────────────────
  getSettings: cache(async function () {
    const now = Date.now();
    if (memoryCache.settings && now - memoryCache.settingsFetchedAt < CACHE_TTL) {
      return memoryCache.settings;
    }

    let settings = null;
    if (isFirebaseEnabled()) {
      try {
        const { getSettingsFromFirestore } = await getAdapter();
        settings = await getSettingsFromFirestore();
      } catch (err) {
        console.warn("Firestore settings fetch failed. Using local fallback.", err);
      }
    }

    if (!settings || Object.keys(settings).length === 0) {
      settings = await readData(settingsFile, {});
    }

    if (!settings || Object.keys(settings).length === 0) {
      settings = FALLBACK_SETTINGS;
    }

    memoryCache.settings = settings;
    memoryCache.settingsFetchedAt = now;
    return settings;
  }),

  async updateSettings(data: any) {
    memoryCache.settings = undefined;
    memoryCache.settingsFetchedAt = 0;
    let res;
    if (isFirebaseEnabled()) {
      try {
        const { updateSettingsInFirestore } = await getAdapter();
        res = await updateSettingsInFirestore(data);
        emitRealtime("settings");
        return res;
      } catch (err) {
        console.warn("Firestore settings update failed. Using local fallback.", err);
      }
    }
    res = await writeData(settingsFile, data);
    emitRealtime("settings");
    return res;
  },

  // ── Orders ────────────────────────────────────────────────────────────
  async getOrders(filters?: { userId?: string }) {
    if (isFirebaseEnabled()) {
      try {
        const adapter = await getAdapter();
        const orders = filters?.userId
          ? await adapter.getOrdersByUser(filters.userId)
          : await adapter.getAllOrders();
        if (orders) return orders.filter((o: any) => !memoryCache.deletedOrderIds.has(o.id));
      } catch (err) {
        console.warn("Firestore orders fetch failed. Using local fallback.", err);
      }
    }
    const local = await readData(ordersFile, []);
    let res = Array.isArray(local) && local.length > 0 ? local : (FALLBACK_ORDERS as any[]);
    if (filters?.userId) {
      res = res.filter((o: any) => o.userId === filters.userId);
    }
    return res.filter((o: any) => !memoryCache.deletedOrderIds.has(o.id));
  },

  async getOrderById(id: string) {
    if (memoryCache.deletedOrderIds.has(id)) return null;
    if (isFirebaseEnabled()) {
      try {
        const { getOrderById } = await getAdapter();
        const order = await getOrderById(id);
        if (order && Object.keys(order).length > 0) return order;
      } catch (err) {
        console.warn("Firestore getOrderById failed. Using local fallback.", err);
      }
    }
    const orders = await readData(ordersFile, []);
    return orders.find((o: any) => o.id === id) || null;
  },

  async getOrderByConsignmentId(id: number | string) {
    if (isFirebaseEnabled()) {
      try {
        const { getOrderByConsignmentId } = await getAdapter();
        const order = await getOrderByConsignmentId(id);
        if (order) return order;
      } catch (err) {
        console.warn("Firestore getOrderByConsignmentId failed.", err);
      }
    }
    const orders = await readData(ordersFile, []);
    return (
      orders.find(
        (o: any) =>
          o.courierConsignmentId === Number(id) || o.courierConsignmentId === String(id)
      ) || null
    );
  },

  /**
   * Atomic order placement: prevents overselling, race-condition credential pool
   * duplication, price/status tampering, and duplicate mobile-banking TrxID reuse.
   */
  async placeOrderAtomically(params: {
    requestedItems: Array<{ productId: string; quantity: number; variantName?: string | null }>;
    settings: any;
    userId: string;
    userEmail: string;
    shippingAddress: any;
    payment: { method: string; senderNumber?: string; transactionId?: string; accountUsed?: string };
    fulfillment?: any;
    customer?: any;
  }) {
    if (isFirebaseEnabled()) {
      const { placeOrderTransactionInFirestore } = await getAdapter();
      const created = await placeOrderTransactionInFirestore(params);
      memoryCache.products = undefined;
      memoryCache.productsFetchedAt = 0;
      emitRealtime("products");
      emitRealtime("orders");
      emitRealtime("notifications");
      return created;
    }

    // Local / automated test atomic path serialized by mutex
    return await withLocalOrderLock(async () => {
      const products = await readData(productsFile, []);
      const orders = await readData(ordersFile, []);

      const isCodOrder = String(params.payment?.method || "").trim() === "Cash on Delivery";
      if (!isCodOrder) {
        const candidateTrx = String(params.payment?.transactionId || "")
          .trim()
          .toUpperCase();
        if (candidateTrx) {
          const dup = orders.find(
            (o: any) =>
              String(o?.payment?.transactionId || "")
                .trim()
                .toUpperCase() === candidateTrx
          );
          if (dup) {
            throw new OrderBusinessError(
              "This Transaction ID (TrxID) has already been submitted for another order.",
              409
            );
          }
        }
      }

      const productDocsMap = new Map<string, any>();
      for (const p of products) {
        if (p?.id && !memoryCache.deletedProductIds.has(p.id)) {
          productDocsMap.set(p.id, p);
        }
      }

      const { orderRecord, dirtyProducts } = computeAtomicOrderCheckout({
        ...params,
        productDocsMap,
      });

      if (dirtyProducts.size > 0) {
        for (let i = 0; i < products.length; i++) {
          const patch = dirtyProducts.get(products[i].id);
          if (patch) {
            products[i] = { ...products[i], ...patch };
          }
        }
        await writeData(productsFile, products);
      }

      const newOrder = {
        id: crypto.randomUUID(),
        ...orderRecord,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      orders.push(newOrder);
      await writeData(ordersFile, orders);

      memoryCache.products = undefined;
      memoryCache.productsFetchedAt = 0;
      emitRealtime("products");
      emitRealtime("orders");
      emitRealtime("notifications");
      return newOrder;
    });
  },

  /**
   * Atomic, idempotent stock & unrevealed credential restoration on order cancellation.
   */
  async restoreCancelledOrderStockAtomically(orderId: string): Promise<boolean> {
    if (isFirebaseEnabled()) {
      const { restoreCancelledOrderStockInFirestore } = await getAdapter();
      const restored = await restoreCancelledOrderStockInFirestore(orderId);
      if (restored) {
        memoryCache.products = undefined;
        memoryCache.productsFetchedAt = 0;
        emitRealtime("products");
      }
      return restored;
    }

    return await withLocalOrderLock(async () => {
      const orders = await readData(ordersFile, []);
      const ordIdx = orders.findIndex((o: any) => o.id === orderId);
      if (ordIdx === -1) return false;
      const order = orders[ordIdx];
      if (order.stockRestored) return false;

      const products = await readData(productsFile, []);
      let productsModified = false;

      if (
        order.paymentStatus !== "confirmed" &&
        order.paymentStatus !== "refunded" &&
        Array.isArray(order.deliveries)
      ) {
        for (const d of order.deliveries) {
          if (!d?.productId || d.revealed) continue;
          const pIdx = products.findIndex((p: any) => p.id === d.productId);
          if (pIdx === -1) continue;
          const prod = products[pIdx];
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
              if (resolveVirtualStockMode(prod) === "pool") prod.stock = nextPool.length;
              productsModified = true;
            }
          } else if (d.type === "account" && d.value && d.password) {
            const emailClean = String(d.value).trim();
            const passClean = String(d.password).trim();
            const exists = (cfg.credentialPool || []).some(
              (c: any) =>
                String(c?.email || "").trim() === emailClean &&
                String(c?.password || "").trim() === passClean
            );
            if (!exists) {
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
              if (resolveVirtualStockMode(prod) === "pool") prod.stock = nextPool.length;
              productsModified = true;
            }
          }
        }
      }

      if (order.stockDeducted && Array.isArray(order.items)) {
        for (const item of order.items) {
          const pIdx = products.findIndex((p: any) => p.id === item?.productId);
          if (pIdx === -1) continue;
          const prod = products[pIdx];
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
            productsModified = true;
          } else if (prod.stock !== undefined && prod.stock !== null) {
            prod.stock = Math.max(0, Number(prod.stock) + qty);
            productsModified = true;
          }
        }
      }

      if (productsModified) {
        await writeData(productsFile, products);
        memoryCache.products = undefined;
        memoryCache.productsFetchedAt = 0;
        emitRealtime("products");
      }

      orders[ordIdx] = { ...order, stockRestored: true, updatedAt: new Date().toISOString() };
      await writeData(ordersFile, orders);
      return true;
    });
  },

  async createOrder(data: any) {
    if (isFirebaseEnabled()) {
      try {
        const { createOrderInFirestore } = await getAdapter();
        const created = await createOrderInFirestore(data);
        emitRealtime("orders");
        emitRealtime("notifications");
        return created;
      } catch (err) {
        console.warn("Firestore createOrder failed. Using local fallback.", err);
      }
    }
    const orders = await readData(ordersFile, []);
    const newOrder = { id: crypto.randomUUID(), ...data, createdAt: new Date().toISOString() };
    orders.push(newOrder);
    await writeData(ordersFile, orders);
    emitRealtime("orders");
    emitRealtime("notifications");
    return newOrder;
  },

  async updateOrder(id: string, fields: any) {
    if (isFirebaseEnabled()) {
      try {
        const { updateOrderInFirestore } = await getAdapter();
        const res = await updateOrderInFirestore(id, fields);
        emitRealtime("orders");
        emitRealtime("notifications");
        return res;
      } catch (err) {
        console.warn("Firestore updateOrder failed. Using local fallback.", err);
      }
    }
    const orders = await readData(ordersFile, []);
    const idx = orders.findIndex((o: any) => o.id === id);
    if (idx !== -1) {
      orders[idx] = { ...orders[idx], ...fields, updatedAt: new Date().toISOString() };
      await writeData(ordersFile, orders);
    }
    emitRealtime("orders");
    emitRealtime("notifications");
  },

  async deleteOrder(id: string) {
    memoryCache.deletedOrderIds.add(id);
    if (isFirebaseEnabled()) {
      try {
        const { deleteOrderFromFirestore } = await getAdapter();
        await deleteOrderFromFirestore(id);
        emitRealtime("orders");
        return;
      } catch (err) {
        console.warn("Firestore deleteOrder failed. Using local fallback.", err);
      }
    }
    const orders = await readData(ordersFile, []);
    const filtered = orders.filter((o: any) => o.id !== id);
    await writeData(ordersFile, filtered);
    emitRealtime("orders");
  },

  async getPendingOrdersCount() {
    if (isFirebaseEnabled()) {
      try {
        const { getPendingOrdersCount } = await getAdapter();
        return await getPendingOrdersCount();
      } catch (err) {
        console.warn("Firestore getPendingOrdersCount failed. Using local fallback.", err);
      }
    }
    const orders = await readData(ordersFile, []);
    return orders.filter((o: any) => o.orderStatus === "pending").length;
  },

  // ── Products ──────────────────────────────────────────────────────────
  getProducts: cache(async function () {
    const now = Date.now();
    if (memoryCache.products && now - memoryCache.productsFetchedAt < CACHE_TTL) {
      return memoryCache.products.filter((p: any) => !memoryCache.deletedProductIds.has(p.id));
    }

    let products = null;
    if (isFirebaseEnabled()) {
      try {
        const { getProductsFromFirestore } = await getAdapter();
        products = await getProductsFromFirestore();
      } catch (err) {
        console.warn("Firestore products fetch failed. Using local fallback.", err);
      }
    }

    if (!products || products.length === 0) {
      products = await readData(productsFile, []);
    }

    if (!products || products.length === 0) {
      products = FALLBACK_PRODUCTS;
    }

    memoryCache.products = products;
    memoryCache.productsFetchedAt = now;
    return products.filter((p: any) => !memoryCache.deletedProductIds.has(p.id));
  }),

  async getProductById(id: string) {
    const products = await this.getProducts();
    return products.find((p: any) => p.id === id) || null;
  },

  async createProduct(data: any) {
    memoryCache.products = undefined;
    memoryCache.productsFetchedAt = 0;
    if (isFirebaseEnabled()) {
      try {
        const { createProductInFirestore } = await getAdapter();
        const created = await createProductInFirestore(data);
        emitRealtime("products");
        return created;
      } catch (err) {
        console.warn("Firestore createProduct failed. Using local fallback.", err);
      }
    }
    const products = await readData(productsFile, []);
    const newProduct = { id: crypto.randomUUID(), ...data };
    products.push(newProduct);
    await writeData(productsFile, products);
    emitRealtime("products");
    return newProduct;
  },

  async updateProduct(id: string, data: any) {
    memoryCache.products = undefined;
    memoryCache.productsFetchedAt = 0;
    if (isFirebaseEnabled()) {
      try {
        const { updateProductInFirestore } = await getAdapter();
        const res = await updateProductInFirestore(id, data);
        emitRealtime("products");
        return res;
      } catch (err) {
        console.warn("Firestore updateProduct failed. Using local fallback.", err);
      }
    }
    const products = await readData(productsFile, []);
    const idx = products.findIndex((p: any) => p.id === id);
    if (idx !== -1) {
      products[idx] = { ...products[idx], ...data };
      await writeData(productsFile, products);
    }
    emitRealtime("products");
  },

  async deleteProduct(id: string) {
    memoryCache.deletedProductIds.add(id);
    memoryCache.products = undefined;
    memoryCache.productsFetchedAt = 0;
    if (isFirebaseEnabled()) {
      try {
        const { deleteProductFromFirestore } = await getAdapter();
        const res = await deleteProductFromFirestore(id);
        emitRealtime("products");
        return res;
      } catch (err) {
        console.warn("Firestore deleteProduct failed. Using local fallback.", err);
      }
    }
    const products = await readData(productsFile, []);
    const filtered = products.filter((p: any) => p.id !== id);
    await writeData(productsFile, filtered);
    emitRealtime("products");
  },

  // ── Notifications ─────────────────────────────────────────────────────
  async getNotificationById(id: string) {
    if (isFirebaseEnabled()) {
      try {
        const { getNotificationById } = await getAdapter();
        return await getNotificationById(id);
      } catch (err) {
        console.warn("Firestore getNotificationById failed.", err);
      }
    }
    return null;
  },

  async getNotifications(recipient: string = "admin", limit: number = 20) {
    if (isFirebaseEnabled()) {
      try {
        const { getNotifications } = await getAdapter();
        return await getNotifications(recipient, limit);
      } catch (err) {
        console.warn("Firestore notifications fetch failed.", err);
      }
    }
    return [];
  },

  async markNotificationAsRead(id: string) {
    if (isFirebaseEnabled()) {
      try {
        const { markNotificationAsRead } = await getAdapter();
        const res = await markNotificationAsRead(id);
        emitRealtime("notifications");
        return res;
      } catch (err) {
        console.warn("Firestore markNotificationAsRead failed.", err);
      }
    }
    emitRealtime("notifications");
  },

  async markAllNotificationsAsRead(recipient: string = "admin") {
    if (isFirebaseEnabled()) {
      try {
        const { markAllNotificationsAsRead } = await getAdapter();
        const res = await markAllNotificationsAsRead(recipient);
        emitRealtime("notifications");
        return res;
      } catch (err) {
        console.warn("Firestore markAllNotificationsAsRead failed.", err);
      }
    }
    emitRealtime("notifications");
  },

  async deleteNotification(id: string) {
    if (isFirebaseEnabled()) {
      try {
        const { deleteNotification } = await getAdapter();
        const res = await deleteNotification(id);
        emitRealtime("notifications");
        return res;
      } catch (err) {
        console.warn("Firestore deleteNotification failed.", err);
      }
    }
    emitRealtime("notifications");
  },

  async clearAllNotifications(recipient: string = "admin") {
    if (isFirebaseEnabled()) {
      try {
        const { clearAllNotifications } = await getAdapter();
        const res = await clearAllNotifications(recipient);
        emitRealtime("notifications");
        return res;
      } catch (err) {
        console.warn("Firestore clearAllNotifications failed.", err);
      }
    }
    emitRealtime("notifications");
  },

  async savePushToken(uid: string, token: string) {
    if (isFirebaseEnabled()) {
      try {
        const { savePushTokenInFirestore } = await getAdapter();
        return await savePushTokenInFirestore(uid, token);
      } catch (err) {
        console.warn("Firestore savePushToken failed.", err);
      }
    }
  },

  async deletePushToken(uid: string, token: string, isStaff = false) {
    if (isFirebaseEnabled()) {
      try {
        const { deletePushTokenInFirestore } = await getAdapter();
        return await deletePushTokenInFirestore(uid, token, isStaff);
      } catch (err) {
        console.warn("Firestore deletePushToken failed.", err);
      }
    }
  },

  // ── User Profiles ─────────────────────────────────────────────────────
  async getUserProfile(uid: string) {
    if (isFirebaseEnabled()) {
      try {
        const adapter = await getAdapter();
        const result =
          (await adapter.getUserProfileFromFirestore(uid)) ||
          (await adapter.getUserProfileFromRTDB(uid));
        if (result) return result;
      } catch {}
    }

    const profiles = await readData(profilesFile, {});
    return (profiles as any)[uid] || null;
  },

  async getCustomersCount() {
    if (isFirebaseEnabled()) {
      try {
        const { getCustomersCountInFirestore } = await getAdapter();
        return await getCustomersCountInFirestore();
      } catch {}
    }
    const profiles = await readData(profilesFile, {});
    return Object.keys(profiles).length;
  },

  async updateUserProfile(uid: string, data: any) {
    // Defense in depth: never permit `role`, `isAdmin`, `uid`, or `email` mutation via profile updates
    const safeData = stripRestrictedProfileFields(data);

    try {
      const profiles = await readData(profilesFile, {});
      (profiles as any)[uid] = {
        ...(profiles as any)[uid],
        ...safeData,
        updatedAt: new Date().toISOString(),
      };
      await writeData(profilesFile, profiles);
    } catch {}

    if (isFirebaseEnabled()) {
      try {
        const adapter = await getAdapter();
        await adapter.updateUserProfileInFirestore(uid, safeData).catch(() => {});
        await adapter.updateUserProfileInRTDB(uid, safeData).catch(() => {});
      } catch {}
    }
  },

  // ── Media Storage ─────────────────────────────────────────────────────
  async getMedia() {
    if (isFirebaseEnabled()) {
      try {
        const adapter = await getAdapter();
        const snap = await adapter.adminDb
          .collection("media")
          .orderBy("uploadedAt", "desc")
          .get();
        if (!snap.empty) return snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));

        const rtdb = adapter.getAdminRtDb();
        const rtsnap = await rtdb.ref("media").get();
        if (rtsnap.exists()) {
          const data = rtsnap.val();
          return Object.values(data).sort(
            (a: any, b: any) =>
              new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
          );
        }
      } catch {}
    }
    return await readData(path.join(process.cwd(), "data", "media.json"), []);
  },

  async syncMediaWithImageKit(credentials: {
    publicKey: string;
    privateKey: string;
    endpoint: string;
  }) {
    if (!isFirebaseEnabled() || !credentials.privateKey) return 0;
    const authHeader =
      "Basic " + Buffer.from(credentials.privateKey + ":").toString("base64");
    const response = await fetch(
      "https://api.imagekit.io/v1/files?path=/products&limit=1000",
      {
        headers: { Authorization: authHeader },
        signal: AbortSignal.timeout(15000),
      }
    );

    if (!response.ok) throw new Error("ImageKit sync failed");
    const ikFiles = await response.json();

    const currentMedia = await this.getMedia();
    const existingUrls = new Set(currentMedia.map((m: any) => m.url));

    const adapter = await getAdapter();
    const batchSize = 100;
    let count = 0;

    for (let i = 0; i < ikFiles.length; i += batchSize) {
      const chunk = ikFiles.slice(i, i + batchSize);
      const batch = adapter.adminDb.batch();
      let batchAdded = false;

      for (const file of chunk) {
        if (!existingUrls.has(file.url)) {
          const docRef = adapter.adminDb.collection("media").doc();
          batch.set(docRef, {
            name: file.name,
            url: file.url,
            size: file.size,
            deleteUrl: file.fileId,
            imgbbId: "",
            uploadedAt: file.createdAt || new Date().toISOString(),
          });
          batchAdded = true;
          count++;
        }
      }
      if (batchAdded) await batch.commit();
    }
    return count;
  },

  async saveMedia(mediaData: any) {
    try {
      const mediaFile = path.join(process.cwd(), "data", "media.json");
      const list = await readData(mediaFile, []);
      list.unshift({ ...mediaData, id: crypto.randomUUID() });
      await writeData(mediaFile, list);
    } catch {}

    if (isFirebaseEnabled()) {
      try {
        const adapter = await getAdapter();
        await adapter.adminDb.collection("media").add({
          ...mediaData,
          uploadedAt: new Date().toISOString(),
        });
        const rtdb = adapter.getAdminRtDb();
        await rtdb.ref("media").push({
          ...mediaData,
          uploadedAt: new Date().toISOString(),
        });
      } catch {}
    }
  },

  async deleteMedia(filename: string) {
    try {
      const mediaFile = path.join(process.cwd(), "data", "media.json");
      const list = await readData(mediaFile, []);
      const filtered = list.filter((m: any) => m.name !== filename);
      await writeData(mediaFile, filtered);
    } catch {}

    if (isFirebaseEnabled()) {
      try {
        const adapter = await getAdapter();
        const snap = await adapter.adminDb
          .collection("media")
          .where("name", "==", filename)
          .get();
        const batch = adapter.adminDb.batch();
        snap.docs.forEach((d: any) => batch.delete(d.ref));
        await batch.commit();

        const rtdb = adapter.getAdminRtDb();
        const rtsnap = await rtdb.ref("media").orderByChild("name").equalTo(filename).get();
        if (rtsnap.exists()) {
          rtsnap.forEach((child: any) => {
            child.ref.remove();
            return true;
          });
        }
      } catch {}
    }
  },

  async incrementTraffic() {
    if (isFirebaseEnabled()) {
      try {
        const { incrementTrafficCount } = await getAdapter();
        await incrementTrafficCount();
      } catch {}
    }
  },

  async getTraffic() {
    if (isFirebaseEnabled()) {
      try {
        const { getTrafficCount } = await getAdapter();
        return await getTrafficCount();
      } catch {}
    }
    return 0;
  },

  clearMemoryCacheForTesting() {
    memoryCache.settings = undefined;
    memoryCache.settingsFetchedAt = 0;
    memoryCache.products = undefined;
    memoryCache.productsFetchedAt = 0;
    memoryCache.deletedProductIds.clear();
    memoryCache.deletedOrderIds.clear();
  },
};
