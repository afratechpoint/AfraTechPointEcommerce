export type RealtimeTopic = "products" | "orders" | "settings" | "notifications";

export interface RealtimeEvent {
  topic: RealtimeTopic;
  ts: number;
}

type Listener = (event: RealtimeEvent) => void;

interface HubState {
  listeners: Set<Listener>;
  watchersStarted: boolean;
  cacheInvalidators: Set<(topic: RealtimeTopic) => void>;
}

const g = globalThis as unknown as { __afraRealtimeHub?: HubState };

function getHub(): HubState {
  if (!g.__afraRealtimeHub) {
    g.__afraRealtimeHub = {
      listeners: new Set(),
      watchersStarted: false,
      cacheInvalidators: new Set(),
    };
  }
  return g.__afraRealtimeHub;
}

export function onRealtimeCacheInvalidate(fn: (topic: RealtimeTopic) => void) {
  getHub().cacheInvalidators.add(fn);
}

export function emitRealtime(topic: RealtimeTopic) {
  const hub = getHub();
  hub.cacheInvalidators.forEach((inv) => {
    try {
      inv(topic);
    } catch {}
  });
  const evt: RealtimeEvent = { topic, ts: Date.now() };
  hub.listeners.forEach((listener) => {
    try {
      listener(evt);
    } catch {}
  });
}

export function subscribeServerRealtime(listener: Listener): () => void {
  const hub = getHub();
  hub.listeners.add(listener);
  ensureFirestoreWatchers();
  return () => {
    hub.listeners.delete(listener);
  };
}

export async function ensureFirestoreWatchers() {
  const hub = getHub();
  if (hub.watchersStarted) return;
  if (process.env.NEXT_PUBLIC_USE_FIREBASE !== "true") return;

  hub.watchersStarted = true;

  try {
    const { adminDb } = await import("./firebase/admin");

    const watchCollection = (colName: string, topic: RealtimeTopic) => {
      let initial = true;
      adminDb.collection(colName).onSnapshot(
        () => {
          if (initial) {
            initial = false;
            return;
          }
          emitRealtime(topic);
        },
        (err: any) => {
          console.warn(`[Realtime] Watcher error on ${colName}:`, err?.message);
        }
      );
    };

    watchCollection("products", "products");
    watchCollection("orders", "orders");
    watchCollection("notifications", "notifications");

    let initialSettings = true;
    adminDb
      .collection("config")
      .doc("main")
      .onSnapshot(
        () => {
          if (initialSettings) {
            initialSettings = false;
            return;
          }
          emitRealtime("settings");
        },
        (err: any) => {
          console.warn("[Realtime] Watcher error on config/main:", err?.message);
        }
      );
  } catch (err: any) {
    hub.watchersStarted = false;
    console.warn("[Realtime] Failed to attach Firestore watchers:", err?.message);
  }
}
