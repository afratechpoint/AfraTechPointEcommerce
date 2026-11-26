"use client";

import { useEffect, useRef } from "react";

export type RealtimeTopic = "products" | "orders" | "settings" | "notifications";

type TopicCallback = (topic: RealtimeTopic) => void;

const subscribers = new Set<TopicCallback>();
let eventSource: EventSource | null = null;
let broadcastChannel: BroadcastChannel | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let leaderStarted = false;
let isLeaderTab = false;

function notifyLocalSubscribers(topic: RealtimeTopic) {
  subscribers.forEach((cb) => {
    try {
      cb(topic);
    } catch {}
  });
}

function getChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
    return null;
  }
  if (!broadcastChannel) {
    try {
      broadcastChannel = new BroadcastChannel("afra_live_sync_v2");
      broadcastChannel.onmessage = (e) => {
        const topic = e.data?.topic as RealtimeTopic | undefined;
        if (topic) {
          notifyLocalSubscribers(topic);
        }
      };
    } catch {
      broadcastChannel = null;
    }
  }
  return broadcastChannel;
}

function closeEventSource() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (eventSource) {
    try {
      eventSource.close();
    } catch {}
    eventSource = null;
  }
}

function openLeaderEventSource() {
  if (typeof window === "undefined" || !isLeaderTab) return;
  if (eventSource) return;
  if (subscribers.size === 0) return;

  try {
    const es = new EventSource("/api/realtime");
    eventSource = es;

    es.addEventListener("sync", (e: MessageEvent) => {
      try {
        const parsed = JSON.parse(e.data);
        const topic = parsed?.topic as RealtimeTopic | undefined;
        if (topic) {
          notifyLocalSubscribers(topic);
          // Relay to all other tabs over BroadcastChannel (uses 0 HTTP sockets!)
          try {
            getChannel()?.postMessage({ topic, ts: Date.now() });
          } catch {}
        }
      } catch {}
    });

    es.onerror = () => {
      closeEventSource();
      if (isLeaderTab && subscribers.size > 0 && !reconnectTimer) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          if (isLeaderTab && subscribers.size > 0) {
            openLeaderEventSource();
          }
        }, 3000);
      }
    };
  } catch {}
}

/**
 * Ensures AT MOST ONE tab across the entire browser opens `/api/realtime`,
 * preventing HTTP/1.1 6-connection-per-origin exhaustion when multiple tabs are open.
 * All non-leader tabs receive live events instantly via BroadcastChannel.
 */
function ensureLeaderElection() {
  if (typeof window === "undefined") return;
  getChannel();

  if (leaderStarted) {
    if (isLeaderTab && !eventSource && subscribers.size > 0) {
      openLeaderEventSource();
    }
    return;
  }
  leaderStarted = true;

  if (typeof navigator !== "undefined" && "locks" in navigator && navigator.locks?.request) {
    navigator.locks
      .request("afra_realtime_sse_leader", async () => {
        isLeaderTab = true;
        openLeaderEventSource();
        // Hold the lock for the lifetime of this tab
        await new Promise<void>(() => {});
      })
      .catch(() => {
        isLeaderTab = true;
        openLeaderEventSource();
      });
  } else {
    // Fallback if Web Locks API is unavailable
    isLeaderTab = true;
    openLeaderEventSource();
  }
}

export function broadcastRealtime(topic: RealtimeTopic) {
  notifyLocalSubscribers(topic);
  try {
    getChannel()?.postMessage({ topic, ts: Date.now() });
  } catch {}
}

/**
 * Subscribes a React component to real-time updates for one or more topics,
 * plus refreshes automatically when a backgrounded tab becomes visible again.
 */
export function useRealtime(
  topics: RealtimeTopic | RealtimeTopic[],
  onUpdate: () => void
) {
  const callbackRef = useRef(onUpdate);
  callbackRef.current = onUpdate;

  const topicsKey = Array.isArray(topics) ? topics.join(",") : topics;

  useEffect(() => {
    const allowed = new Set<string>(topicsKey.split(","));
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const trigger = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        callbackRef.current();
      }, 220);
    };

    const listener: TopicCallback = (topic) => {
      if (allowed.has(topic)) trigger();
    };

    subscribers.add(listener);
    ensureLeaderElection();

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        if (isLeaderTab && !eventSource) {
          openLeaderEventSource();
        }
        trigger();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      subscribers.delete(listener);
      document.removeEventListener("visibilitychange", onVisibility);
      if (subscribers.size === 0) {
        closeEventSource();
      }
    };
  }, [topicsKey]);
}
