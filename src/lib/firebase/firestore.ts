// lib/firebase/firestore.ts
// Read-only client-side Firestore subscription helper for authorized staff.
// All mutations (orders, products, inventory, settings, profiles) MUST go through
// server-verified API route handlers — direct client-side write helpers are intentionally omitted.

import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getFirestore,
  collection,
  query,
  orderBy,
  onSnapshot,
} from "firebase/firestore";
import type { Order } from "@/types/order";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const db = getFirestore(app);

function toSafeDate(val: any): Date {
  if (!val) return new Date();
  if (typeof val?.toDate === "function") return val.toDate();
  const d = new Date(val);
  return isNaN(d.getTime()) ? new Date() : d;
}

/**
 * Real-time order badge subscription for authenticated Admin / Order Staff.
 * Enforced by `firestore.rules` (`isOrderStaff()`). Falls back silently if denied,
 * as `AdminClientLayout` also listens on the server SSE `/api/realtime` stream.
 */
export function subscribeToAllOrders(callback: (orders: Order[]) => void) {
  const q = query(collection(db, "orders"), orderBy("createdAt", "desc"));

  return onSnapshot(
    q,
    (snap) => {
      const orders = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          createdAt: toSafeDate(data.createdAt),
          updatedAt: toSafeDate(data.updatedAt),
        } as Order;
      });
      callback(orders);
    },
    () => {
      // Silently ignore client Firestore permission errors — server SSE handles sync
    }
  );
}
