"use client";

import React, { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  LogOut,
  Package,
  ChevronRight,
  Pencil,
  Check,
  X,
  ShoppingBag,
  Bell,
  CheckCheck,
  Trash2,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { updateProfile } from "firebase/auth";
import { toast } from "sonner";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import AdminSelect from "@/components/admin/AdminSelect";
import { useAuth } from "@/contexts/AuthContext";
import { useSettings } from "@/components/SettingsProvider";
import PremiumLoader from "@/components/PremiumLoader";
import { useRealtime } from "@/lib/realtime-client";
import { cn } from "@/lib/utils";

type Tab = "orders" | "profile" | "notifications";

interface AccountNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  link?: string;
  isRead: boolean;
  createdAt: string;
}

interface OrderItem {
  name: string;
  quantity: number;
  price: number;
  image?: string;
  variantName?: string;
  productKind?: string;
}

interface Order {
  id: string;
  createdAt: string;
  total?: number;
  totalAmount?: number;
  subtotal?: number;
  deliveryCharge?: number;
  status?: string;
  orderStatus?: string;
  paymentStatus?: string;
  cancellationReason?: string;
  paymentMethod?: string;
  payment?: { method?: string };
  hasPhysical?: boolean;
  items: OrderItem[];
}

function getOrderStatusMeta(rawStatus: string, isVirtual: boolean) {
  const s = (rawStatus || "pending").toLowerCase();
  if (s === "delivered" || s === "completed") {
    return {
      label: isVirtual ? "Completed" : "Delivered",
      cls: "bg-emerald-50 text-emerald-700 border-emerald-200",
    };
  }
  if (s === "shipped") {
    return {
      label: "Shipped",
      cls: "bg-gray-100 text-gray-800 border-gray-200",
    };
  }
  if (s === "processing") {
    return {
      label: isVirtual ? "In Progress" : "Processing",
      cls: "bg-gray-100 text-gray-800 border-gray-200",
    };
  }
  if (s === "cancelled") {
    return {
      label: "Cancelled",
      cls: "bg-red-50 text-red-600 border-red-200",
    };
  }
  return {
    label: "Pending",
    cls: "bg-amber-50 text-amber-700 border-amber-200",
  };
}

function getPaymentStatusMeta(rawPayStatus: string) {
  const p = (rawPayStatus || "pending").toLowerCase();
  if (p === "refunded") {
    return {
      label: "Refunded",
      cls: "bg-blue-50 text-blue-700 border-blue-200",
    };
  }
  if (p === "confirmed") {
    return {
      label: "Paid",
      cls: "bg-emerald-50 text-emerald-700 border-emerald-200",
    };
  }
  if (p === "pending_cod") {
    return {
      label: "Cash on Delivery",
      cls: "bg-gray-100 text-gray-700 border-gray-200",
    };
  }
  if (p === "cancelled" || p === "failed") {
    return {
      label: p === "failed" ? "Payment Failed" : "Cancelled",
      cls: "bg-red-50 text-red-600 border-red-200",
    };
  }
  return {
    label: "Awaiting Verification",
    cls: "bg-amber-50 text-amber-700 border-amber-200",
  };
}

function AccountContent() {
  const { user, loading, logout, displayName: contextName, photoURL: contextPhoto } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const settings = useSettings();

  const urlTab = searchParams.get("tab") as Tab | null;
  const [tab, setTab] = useState<Tab>(
    urlTab === "profile" || urlTab === "notifications" || urlTab === "orders"
      ? urlTab
      : "orders"
  );

  useEffect(() => {
    if (urlTab === "profile" || urlTab === "notifications" || urlTab === "orders") {
      setTab(urlTab);
    }
  }, [urlTab]);

  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [division, setDivision] = useState("");
  const [district, setDistrict] = useState("");
  const [upazila, setUpazila] = useState("");
  const [bio, setBio] = useState("");
  const [imgError, setImgError] = useState(false);

  const [geoDivisions, setGeoDivisions] = useState<any[]>([]);
  const [geoDistricts, setGeoDistricts] = useState<any[]>([]);
  const [geoUpazilas, setGeoUpazilas] = useState<any[]>([]);

  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);

  const [notifications, setNotifications] = useState<AccountNotification[]>([]);
  const [notifsLoading, setNotifsLoading] = useState(false);
  const [notifFilter, setNotifFilter] = useState<"all" | "unread">("all");
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);
  const [deletingNotifId, setDeletingNotifId] = useState<string | null>(null);

  const fetchNotifications = React.useCallback(
    async (silent = false) => {
      if (!user) return;
      if (!silent) setNotifsLoading(true);
      try {
        const token = await user.getIdToken();
        const res = await fetch(`/api/notifications?recipient=${user.uid}&limit=50`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (res.ok) {
          const data = await res.json();
          if (data.notifications && Array.isArray(data.notifications)) {
            setNotifications(data.notifications);
          }
        }
      } catch (err) {
        console.error("Failed to fetch customer notifications:", err);
      } finally {
        if (!silent) setNotifsLoading(false);
      }
    },
    [user]
  );

  useEffect(() => {
    if (user) {
      fetchNotifications(tab !== "notifications");
    }
  }, [user, tab, fetchNotifications]);

  const unreadNotifsCount = notifications.filter((n) => !n.isRead).length;

  const markNotificationRead = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
    try {
      const token = await user?.getIdToken();
      await fetch("/api/notifications", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ id }),
      });
    } catch (err) {
      console.error("Failed to mark notification read:", err);
    }
  };

  const markAllNotificationsRead = async () => {
    if (!user || unreadNotifsCount === 0) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    toast.success("All notifications marked as read");
    try {
      const token = await user.getIdToken();
      await fetch("/api/notifications", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ all: true, recipient: user.uid }),
      });
    } catch {
      fetchNotifications(true);
    }
  };

  const deleteNotification = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setDeletingNotifId(id);
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    try {
      const token = await user?.getIdToken();
      await fetch(`/api/notifications?id=${id}&recipient=${user?.uid}`, {
        method: "DELETE",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
    } catch (err) {
      console.error("Failed to delete notification:", err);
    } finally {
      setDeletingNotifId(null);
    }
  };

  const clearAllNotifications = async () => {
    if (!user || notifications.length === 0) return;
    setClearingAll(true);
    setNotifications([]);
    setShowClearConfirm(false);
    toast.success("Notifications cleared");
    try {
      const token = await user.getIdToken();
      await fetch(`/api/notifications?all=true&recipient=${user.uid}`, {
        method: "DELETE",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
    } catch {
      fetchNotifications(true);
    } finally {
      setClearingAll(false);
    }
  };

  const handleNotificationCardClick = (n: AccountNotification) => {
    if (!n.isRead) markNotificationRead(n.id);
    if (n.link) router.push(n.link);
  };

  const formatNotifTime = (dateInput: string | Date) => {
    try {
      const d = typeof dateInput === "string" ? new Date(dateInput).getTime() : dateInput.getTime();
      if (isNaN(d)) return "";
      const diff = Math.floor((Date.now() - d) / 1000);
      if (diff < 30) return "Just now";
      if (diff < 60) return `${diff}s ago`;
      if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
      if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
      if (diff < 86400 * 2) return "Yesterday";
      return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    } catch {
      return "";
    }
  };

  useEffect(() => {
    const fetchProfile = async () => {
      if (!user || isEditing) return;

      setDisplayName(user.displayName ?? "");

      const cached = localStorage.getItem(`afra_profile_${user.uid}`);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (parsed.displayName) setDisplayName(parsed.displayName);
          setPhone(parsed.phone ?? "");
          setAddress(parsed.address ?? "");
          setDivision(parsed.division ?? "");
          setDistrict(parsed.district ?? "");
          setUpazila(parsed.upazila ?? "");
          setBio(parsed.bio ?? "");
        } catch {}
      }

      try {
        const idToken = await user.getIdToken();
        const res = await fetch("/api/profile", {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (data && Object.keys(data).length > 0) {
            if (data.displayName) setDisplayName(data.displayName);
            setPhone(data.phone ?? "");
            setAddress(data.address ?? "");
            setDivision(data.division ?? "");
            setDistrict(data.district ?? "");
            setUpazila(data.upazila ?? "");
            setBio(data.bio ?? "");
            localStorage.setItem(`afra_profile_${user.uid}`, JSON.stringify(data));
          }
        }
      } catch {}
    };

    fetchProfile();
  }, [user, isEditing]);

  useEffect(() => {
    if (!isEditing) return;
    fetch("/api/geo/divisions")
      .then((r) => r.json())
      .then((d) => {
        if (d?.data) setGeoDivisions(d.data);
      })
      .catch(() => {});
  }, [isEditing]);

  useEffect(() => {
    if (!isEditing || !division) {
      setGeoDistricts([]);
      setGeoUpazilas([]);
      return;
    }
    fetch(`/api/geo/division/${division.toLowerCase()}`)
      .then((r) => r.json())
      .then((d) => {
        if (d?.data) setGeoDistricts(d.data);
      })
      .catch(() => {});
  }, [isEditing, division]);

  useEffect(() => {
    if (!isEditing || !district || !geoDistricts.length) {
      setGeoUpazilas([]);
      return;
    }
    const distObj = geoDistricts.find(
      (d) => d.district.toLowerCase() === district.toLowerCase()
    );
    setGeoUpazilas(distObj?.upazilla || []);
  }, [isEditing, district, geoDistricts]);

  const fetchUserOrders = React.useCallback(
    async (silent = false) => {
      if (!user) return;
      if (!silent) setOrdersLoading(true);
      try {
        const token = await user.getIdToken();
        const r = await fetch(`/api/orders?userId=${user.uid}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (!r.ok) return;
        const data = await r.json();
        if (Array.isArray(data)) {
          setOrders(
            data.sort(
              (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            )
          );
        }
      } catch (err) {
        console.error("Orders fetch failed:", err);
      } finally {
        if (!silent) setOrdersLoading(false);
      }
    },
    [user]
  );

  useEffect(() => {
    if (user) {
      fetchUserOrders(orders.length > 0);
    }
  }, [tab, user, fetchUserOrders]);

  useRealtime(["orders", "notifications"], () => {
    fetchUserOrders(true);
    fetchNotifications(true);
  });

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [user, loading, router]);

  if (loading || !user) return <PremiumLoader />;

  const handleSave = async () => {
    if (!displayName.trim()) {
      toast.error("Name cannot be empty.");
      return;
    }
    if (phone && !/^\d{11}$/.test(phone)) {
      toast.error("Phone number must be exactly 11 digits.");
      return;
    }
    setIsSaving(true);
    const profileData = { phone, address, division, district, upazila, bio, displayName };

    try {
      await updateProfile(user, { displayName: displayName.trim() });
      const idToken = await user.getIdToken();
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ data: profileData }),
      });

      if (res.ok) {
        toast.success("Profile updated");
      } else {
        toast.info("Profile saved locally");
      }

      localStorage.setItem(`afra_profile_${user.uid}`, JSON.stringify(profileData));
      setIsEditing(false);
    } catch {
      localStorage.setItem(`afra_profile_${user.uid}`, JSON.stringify(profileData));
      toast.info("Profile updated locally");
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
    const cached = localStorage.getItem(`afra_profile_${user.uid}`);
    setDisplayName(user.displayName ?? "");
    if (cached) {
      try {
        const data = JSON.parse(cached);
        if (data.displayName) setDisplayName(data.displayName);
        setPhone(data.phone ?? "");
        setAddress(data.address ?? "");
        setDivision(data.division ?? "");
        setDistrict(data.district ?? "");
        setUpazila(data.upazila ?? "");
        setBio(data.bio ?? "");
      } catch {}
    }
  };

  const switchTab = (nextTab: Tab) => {
    setTab(nextTab);
    router.push(`/account?tab=${nextTab}`, { scroll: false });
  };

  const currency = settings?.currencySymbol ?? "৳";
  const initials = (contextName ?? user.email ?? "U")[0].toUpperCase();
  const fullLocation = [address, upazila, district, division].filter(Boolean).join(", ");

  const divisionOptions = [
    { value: "", label: "Select Division" },
    ...geoDivisions.map((d) => ({ value: d.division, label: d.division })),
  ];
  const districtOptions = [
    { value: "", label: division ? "Select District" : "Select division first" },
    ...geoDistricts.map((d) => ({ value: d.district, label: d.district })),
  ];
  const upazilaOptions = [
    { value: "", label: district ? "Select Upazila / Area" : "Select district first" },
    ...geoUpazilas.map((u: string) => ({ value: u, label: u })),
  ];

  const filteredNotifs =
    notifFilter === "unread" ? notifications.filter((n) => !n.isRead) : notifications;

  return (
    <div className="flex flex-col w-full min-h-screen bg-white text-gray-900">
      <Navbar searchEnabled={false} />

      <main className="flex-1 w-full max-w-[1800px] mx-auto px-4 sm:px-6 md:px-8 lg:px-12 py-6 md:py-10">
        {/* ── Compact Account Header ── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-gray-200">
          <div className="flex items-center gap-3.5 min-w-0">
            {contextPhoto && !imgError ? (
              <div className="w-12 h-12 rounded-full overflow-hidden border border-gray-200 shrink-0 bg-gray-50">
                <Image
                  src={contextPhoto}
                  alt={contextName ?? "Account"}
                  width={48}
                  height={48}
                  className="w-full h-full object-cover"
                  unoptimized
                  onError={() => setImgError(true)}
                />
              </div>
            ) : (
              <div className="w-12 h-12 rounded-full bg-black text-white flex items-center justify-center shrink-0 text-base font-bold">
                {initials}
              </div>
            )}
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-bold text-gray-900 truncate">
                {contextName || displayName || "My Account"}
              </h1>
              <p className="text-xs sm:text-sm text-gray-500 truncate">{user.email}</p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 self-start sm:self-auto">
            <Link
              href="/shop"
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl border border-gray-200 text-xs font-semibold text-gray-700 hover:border-black hover:text-black transition-colors"
            >
              <ShoppingBag size={14} /> Shop
            </Link>
            <button
              onClick={async () => {
                await logout();
                router.push("/");
              }}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl border border-gray-200 text-xs font-semibold text-gray-600 hover:border-red-200 hover:bg-red-50 hover:text-red-600 transition-colors cursor-pointer"
            >
              <LogOut size={14} /> Sign Out
            </button>
          </div>
        </div>

        {/* ── Clean Navigation Tabs ── */}
        <div className="flex items-center gap-1 border-b border-gray-200 mt-2 mb-6 overflow-x-auto no-scrollbar">
          {(
            [
              { id: "orders", label: "Orders", badge: orders.length > 0 ? orders.length : undefined },
              { id: "profile", label: "Profile" },
              {
                id: "notifications",
                label: "Notifications",
                badge: unreadNotifsCount > 0 ? unreadNotifsCount : undefined,
                alert: unreadNotifsCount > 0,
              },
            ] as { id: Tab; label: string; badge?: number; alert?: boolean }[]
          ).map((item) => {
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => switchTab(item.id)}
                className={cn(
                  "relative px-4 py-3 text-sm font-semibold transition-colors whitespace-nowrap flex items-center gap-2 cursor-pointer",
                  active ? "text-black" : "text-gray-500 hover:text-gray-900"
                )}
              >
                <span>{item.label}</span>
                {item.badge !== undefined && (
                  <span
                    className={cn(
                      "px-1.5 py-0.5 text-[11px] font-bold rounded-full leading-none",
                      item.alert
                        ? "bg-black text-white"
                        : active
                        ? "bg-gray-900 text-white"
                        : "bg-gray-100 text-gray-600"
                    )}
                  >
                    {item.badge > 99 ? "99+" : item.badge}
                  </span>
                )}
                {active && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-black rounded-full" />
                )}
              </button>
            );
          })}
        </div>

        {/* ══ TAB 1: ORDERS ══════════════════════════════════════════════════ */}
        {tab === "orders" && (
          <div>
            {ordersLoading && orders.length === 0 ? (
              <div className="py-20 flex items-center justify-center">
                <div className="w-6 h-6 border-2 border-gray-200 border-t-black rounded-full animate-spin" />
              </div>
            ) : orders.length === 0 ? (
              <div className="border border-gray-200 rounded-2xl py-16 px-4 text-center">
                <Package size={28} className="text-gray-300 mx-auto mb-3" />
                <p className="text-sm font-semibold text-gray-900">No orders yet</p>
                <p className="text-xs text-gray-500 mt-1 mb-5">
                  When you place an order, it will appear here.
                </p>
                <Link
                  href="/shop"
                  className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-black text-white text-xs font-semibold hover:bg-gray-800 transition-colors"
                >
                  Browse Products
                </Link>
              </div>
            ) : (
              <div className="border border-gray-200 rounded-2xl divide-y divide-gray-100 overflow-hidden bg-white">
                {orders.map((order) => {
                  const firstItem = order.items?.[0];
                  const extraItems = Math.max(0, (order.items?.length ?? 0) - 1);
                  const isVirtual =
                    order.hasPhysical === false ||
                    (Array.isArray(order.items) &&
                      order.items.length > 0 &&
                      order.items.every((it) => it.productKind === "virtual"));

                  const ordMeta = getOrderStatusMeta(
                    order.orderStatus ?? order.status ?? "pending",
                    isVirtual
                  );
                  const payMeta = getPaymentStatusMeta(order.paymentStatus ?? "pending");
                  const total = order.totalAmount ?? order.total ?? 0;
                  const pmtMethod = order.payment?.method ?? order.paymentMethod ?? "—";
                  const shortId = order.id.slice(0, 8).toUpperCase();
                  const dateStr = new Date(order.createdAt).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  });

                  return (
                    <Link
                      key={order.id}
                      href={`/account/orders/${order.id}`}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 sm:px-6 sm:py-5 hover:bg-gray-50/70 transition-colors group"
                    >
                      {/* Left: Product Thumbnail + Order Summary */}
                      <div className="flex items-center gap-4 min-w-0">
                        <div className="w-14 h-14 rounded-xl bg-gray-50 border border-gray-100 overflow-hidden shrink-0 flex items-center justify-center">
                          {firstItem?.image ? (
                            <img
                              src={firstItem.image}
                              alt={firstItem.name}
                              className="w-full h-full object-contain p-1.5"
                            />
                          ) : (
                            <Package size={20} className="text-gray-300" />
                          )}
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-semibold text-gray-900 truncate max-w-[260px] sm:max-w-[420px]">
                              {firstItem?.name || `Order #${shortId}`}
                            </p>
                            {extraItems > 0 && (
                              <span className="text-xs font-medium text-gray-500">
                                +{extraItems} more
                              </span>
                            )}
                          </div>

                          <p className="text-xs text-gray-500 mt-0.5 truncate">
                            {firstItem?.variantName ? `${firstItem.variantName} · ` : ""}
                            <span className="font-mono text-gray-400">#{shortId}</span>
                            {" · "}
                            {dateStr}
                            {pmtMethod && pmtMethod !== "—" ? ` · ${pmtMethod}` : ""}
                          </p>
                          {ordMeta.label === "Cancelled" && order.cancellationReason && (
                            <p className="text-xs text-red-600 mt-1 truncate max-w-[300px] sm:max-w-[520px]">
                              Reason: {order.cancellationReason}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Right: Status Pills + Price + Arrow */}
                      <div className="flex items-center justify-between sm:justify-end gap-4 sm:gap-6 pt-2 sm:pt-0 border-t sm:border-t-0 border-gray-100 shrink-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={cn(
                              "px-2.5 py-1 rounded-lg text-[11px] font-semibold border",
                              payMeta.cls
                            )}
                          >
                            {payMeta.label}
                          </span>
                          <span
                            className={cn(
                              "px-2.5 py-1 rounded-lg text-[11px] font-semibold border",
                              ordMeta.cls
                            )}
                          >
                            {ordMeta.label}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="text-sm sm:text-base font-bold text-gray-900 tabular-nums">
                            {currency}
                            {total.toFixed(2)}
                          </span>
                          <ChevronRight
                            size={16}
                            className="text-gray-400 group-hover:text-black group-hover:translate-x-0.5 transition-all"
                          />
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ══ TAB 2: PROFILE ═════════════════════════════════════════════════ */}
        {tab === "profile" && (
          <div className="border border-gray-200 rounded-2xl p-5 sm:p-7 bg-white">
            <div className="flex items-center justify-between gap-4 pb-5 mb-6 border-b border-gray-100">
              <div>
                <h2 className="text-base font-bold text-gray-900">Personal & Delivery Info</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Used to pre-fill your details during checkout.
                </p>
              </div>

              {!isEditing ? (
                <button
                  onClick={() => setIsEditing(true)}
                  className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl border border-gray-200 text-xs font-semibold text-gray-700 hover:border-black hover:text-black transition-colors cursor-pointer"
                >
                  <Pencil size={13} /> Edit
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCancel}
                    disabled={isSaving}
                    className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-gray-50 transition-colors cursor-pointer"
                  >
                    <X size={13} /> Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="inline-flex items-center gap-1.5 h-9 px-4 rounded-xl bg-black text-white text-xs font-semibold hover:bg-gray-800 transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    <Check size={13} /> {isSaving ? "Saving..." : "Save"}
                  </button>
                </div>
              )}
            </div>

            {!isEditing ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-6 gap-x-8">
                <div>
                  <p className="text-xs font-medium text-gray-400 mb-1">Full Name</p>
                  <p className="text-sm font-semibold text-gray-900">
                    {displayName || contextName || "—"}
                  </p>
                </div>

                <div>
                  <p className="text-xs font-medium text-gray-400 mb-1">Email Address</p>
                  <p className="text-sm font-semibold text-gray-900">{user.email || "—"}</p>
                </div>

                <div>
                  <p className="text-xs font-medium text-gray-400 mb-1">Phone Number</p>
                  <p className="text-sm font-semibold text-gray-900">
                    {phone || <span className="text-gray-400 font-normal">Not provided</span>}
                  </p>
                </div>

                <div>
                  <p className="text-xs font-medium text-gray-400 mb-1">Delivery Address</p>
                  <p className="text-sm font-semibold text-gray-900">
                    {fullLocation || <span className="text-gray-400 font-normal">Not provided</span>}
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                      Full Name
                    </label>
                    <input
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="w-full h-10 px-3.5 rounded-xl bg-white border border-gray-200 text-sm text-gray-900 outline-none focus:border-black transition-colors"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-xs font-semibold text-gray-700">
                        Phone Number
                      </label>
                      <span className="text-[11px] text-gray-400">{phone.length}/11</span>
                    </div>
                    <input
                      type="tel"
                      inputMode="numeric"
                      minLength={11}
                      maxLength={11}
                      pattern="[0-9]{11}"
                      value={phone}
                      onChange={(e) => {
                        const digits = e.target.value.replace(/\D/g, "");
                        const clean =
                          digits.startsWith("8801") && digits.length >= 13
                            ? digits.slice(2, 13)
                            : digits.slice(0, 11);
                        setPhone(clean);
                      }}
                      placeholder="01XXXXXXXXX"
                      className="w-full h-10 px-3.5 rounded-xl bg-white border border-gray-200 text-sm font-mono text-gray-900 outline-none focus:border-black transition-colors"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                      Division
                    </label>
                    <AdminSelect
                      value={division}
                      onChange={(val) => {
                        setDivision(val);
                        setDistrict("");
                        setUpazila("");
                      }}
                      options={divisionOptions}
                      placeholder="Select Division"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                      District
                    </label>
                    <AdminSelect
                      value={district}
                      onChange={(val) => {
                        setDistrict(val);
                        setUpazila("");
                      }}
                      options={districtOptions}
                      placeholder="Select District"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                      Upazila / Area
                    </label>
                    <AdminSelect
                      value={upazila}
                      onChange={(val) => setUpazila(val)}
                      options={upazilaOptions}
                      placeholder="Select Area"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                    Street / House Address
                  </label>
                  <input
                    value={address}
                    onChange={(e) => setAddress(e.target.value.slice(0, 150))}
                    placeholder="House, road, block, or village"
                    maxLength={150}
                    className="w-full h-10 px-3.5 rounded-xl bg-white border border-gray-200 text-sm text-gray-900 outline-none focus:border-black transition-colors"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══ TAB 3: NOTIFICATIONS ═══════════════════════════════════════════ */}
        {tab === "notifications" && (
          <div>
            {/* Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-1.5">
                {(["all", "unread"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setNotifFilter(f)}
                    className={cn(
                      "h-8 px-3.5 rounded-lg text-xs font-semibold capitalize transition-colors cursor-pointer",
                      notifFilter === f
                        ? "bg-black text-white"
                        : "bg-gray-100 text-gray-600 hover:text-black"
                    )}
                  >
                    {f}
                    {f === "unread" && unreadNotifsCount > 0 ? ` (${unreadNotifsCount})` : ""}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => fetchNotifications(false)}
                  disabled={notifsLoading}
                  title="Refresh"
                  className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:border-black hover:text-black transition-colors disabled:opacity-40 cursor-pointer"
                >
                  <RefreshCw size={13} className={notifsLoading ? "animate-spin" : ""} />
                </button>

                {unreadNotifsCount > 0 && (
                  <button
                    onClick={markAllNotificationsRead}
                    className="h-8 px-3 rounded-lg border border-gray-200 text-xs font-semibold text-gray-700 hover:border-black hover:text-black inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <CheckCheck size={13} /> Mark all read
                  </button>
                )}

                {notifications.length > 0 && (
                  <button
                    onClick={() => setShowClearConfirm(true)}
                    className="h-8 px-3 rounded-lg border border-gray-200 text-xs font-semibold text-gray-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600 inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Trash2 size={13} /> Clear
                  </button>
                )}
              </div>
            </div>

            {/* Clear Confirm Modal */}
            {showClearConfirm && (
              <div
                className="fixed inset-0 bg-black/40 z-[150] flex items-center justify-center p-4"
                onClick={() => setShowClearConfirm(false)}
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="bg-white rounded-2xl border border-gray-200 p-6 max-w-sm w-full shadow-xl"
                >
                  <h4 className="text-base font-bold text-gray-900">Clear all notifications?</h4>
                  <p className="text-xs text-gray-500 mt-1.5 mb-5 leading-relaxed">
                    This will remove all {notifications.length} notifications from your account.
                  </p>
                  <div className="flex items-center gap-2.5">
                    <button
                      onClick={() => setShowClearConfirm(false)}
                      className="flex-1 h-9 rounded-xl border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={clearAllNotifications}
                      disabled={clearingAll}
                      className="flex-1 h-9 rounded-xl bg-black text-white text-xs font-semibold hover:bg-gray-800 transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      {clearingAll ? "Clearing..." : "Clear All"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* List */}
            {notifsLoading && notifications.length === 0 ? (
              <div className="py-20 flex items-center justify-center">
                <div className="w-6 h-6 border-2 border-gray-200 border-t-black rounded-full animate-spin" />
              </div>
            ) : filteredNotifs.length === 0 ? (
              <div className="border border-gray-200 rounded-2xl py-16 px-4 text-center">
                <Bell size={26} className="text-gray-300 mx-auto mb-2.5" />
                <p className="text-sm font-semibold text-gray-900">
                  {notifFilter === "unread" ? "No unread notifications" : "No notifications"}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Order confirmations and delivery updates will show up here.
                </p>
              </div>
            ) : (
              <div className="border border-gray-200 rounded-2xl divide-y divide-gray-100 overflow-hidden bg-white">
                {filteredNotifs.map((n) => (
                  <div
                    key={n.id}
                    onClick={() => handleNotificationCardClick(n)}
                    className={cn(
                      "flex items-start justify-between gap-4 p-4 sm:px-6 transition-colors cursor-pointer",
                      !n.isRead ? "bg-gray-50/80 hover:bg-gray-100/60" : "hover:bg-gray-50/50"
                    )}
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <span
                        className={cn(
                          "w-2 h-2 rounded-full mt-1.5 shrink-0",
                          !n.isRead ? "bg-black" : "bg-transparent"
                        )}
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p
                            className={cn(
                              "text-sm text-gray-900",
                              !n.isRead ? "font-bold" : "font-medium"
                            )}
                          >
                            {n.title}
                          </p>
                          <span className="text-xs text-gray-400">
                            {formatNotifTime(n.createdAt)}
                          </span>
                        </div>
                        <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">{n.message}</p>
                        {n.link && (
                          <span className="inline-block mt-1.5 text-xs font-semibold text-gray-900 underline underline-offset-2">
                            View order
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {!n.isRead && (
                        <button
                          onClick={(e) => markNotificationRead(n.id, e)}
                          title="Mark as read"
                          className="p-1.5 rounded-lg text-gray-400 hover:text-black hover:bg-white transition-colors cursor-pointer"
                        >
                          <Check size={14} />
                        </button>
                      )}
                      <button
                        onClick={(e) => deleteNotification(n.id, e)}
                        disabled={deletingNotifId === n.id}
                        title="Remove"
                        className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-white transition-colors cursor-pointer"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}

export default function AccountPage() {
  return (
    <Suspense fallback={<PremiumLoader />}>
      <AccountContent />
    </Suspense>
  );
}
