"use client";

import { useEffect, useRef } from "react";
import { getToken, onMessage } from "firebase/messaging";
import { getPushMessaging } from "@/lib/firebase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

export default function PushNotificationManager() {
  const { user, isAdmin, isShopManager, isOrderManager } = useAuth();
  const router = useRouter();
  const hasRegistered = useRef(false);
  const isStaff = isAdmin || isShopManager || isOrderManager;

  const triggerManualPermission = async (isForAdmin = false) => {
    const messaging = await getPushMessaging();
    if (!messaging || !user) return false;

    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        toast.error("Notification permission denied.");
        return false;
      }

      const token = await getToken(messaging, {
        vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY || "",
      });

      if (token) {
        const uid = isForAdmin && isStaff ? "admin" : user.uid;
        const idToken = await user.getIdToken();

        const res = await fetch("/api/push-token", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ uid, token }),
        });

        if (res.ok) {
          try {
            sessionStorage.setItem("afra_fcm_token", token);
          } catch {}
          toast.success("Notifications enabled successfully!");
          return true;
        }
      }
    } catch (err) {
      console.error("[Push] Manual registration error:", err);
      toast.error("Failed to enable notifications.");
    }
    return false;
  };

  useEffect(() => {
    if (typeof window !== "undefined") {
      (window as any).triggerPushPermission = triggerManualPermission;
    }
  }, [user, isStaff]);

  useEffect(() => {
    if (!user) {
      hasRegistered.current = false;
      return;
    }

    if (
      process.env.NODE_ENV !== "production" &&
      typeof window !== "undefined" &&
      "serviceWorker" in navigator
    ) {
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => regs.forEach((r) => r.unregister().catch(() => {})))
        .catch(() => {});
      if ("caches" in window) {
        caches
          .keys()
          .then((keys) => keys.forEach((k) => caches.delete(k).catch(() => {})))
          .catch(() => {});
      }
      return;
    }

    if (hasRegistered.current) return;

    const setupPush = async () => {
      try {
        if (
          typeof window === "undefined" ||
          typeof Notification === "undefined" ||
          !("serviceWorker" in navigator)
        ) {
          return;
        }
        const messaging = await getPushMessaging();
        if (!messaging) return;

        const permission = await Notification.requestPermission();
        if (permission !== "granted") return;

        const registration = await navigator.serviceWorker.register(
          "/firebase-messaging-sw.js",
          { scope: "/" }
        );
        await registration.update();

        const token = await getToken(messaging, {
          vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
          serviceWorkerRegistration: registration,
        });

        if (token) {
          const idToken = await user.getIdToken();
          try {
            sessionStorage.setItem("afra_fcm_token", token);
          } catch {}

          await fetch("/api/push-token", {
            method: "POST",
            body: JSON.stringify({ uid: user.uid, token }),
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${idToken}`,
            },
          });

          if (isStaff) {
            await fetch("/api/push-token", {
              method: "POST",
              body: JSON.stringify({ uid: "admin", token }),
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${idToken}`,
              },
            });
          }

          hasRegistered.current = true;
        }

        onMessage(messaging, (payload) => {
          if (payload.notification) {
            const rawUrl = payload.data?.url;
            const safePath =
              typeof rawUrl === "string" && rawUrl.startsWith("/") && !rawUrl.startsWith("//")
                ? rawUrl
                : undefined;

            toast(payload.notification.title, {
              description: payload.notification.body,
              action: safePath
                ? {
                    label: "View",
                    onClick: () => router.push(safePath),
                  }
                : undefined,
              duration: 10000,
            });

            if (Notification.permission === "granted") {
              new Notification(payload.notification.title || "Afra Tech Point", {
                body: payload.notification.body,
                icon: payload.notification.icon || "/logo.png",
                tag: "atp-notification-fg",
                data: safePath ? { url: safePath } : {},
              });
            }
          }
        });
      } catch (error) {
        console.error("[Push] Setup error:", error);
      }
    };

    setupPush();
  }, [user, isStaff, router]);

  return null;
}
