"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Search, Trash2, Crown, X } from "lucide-react";
import DeleteConfirmModal from "@/components/admin/DeleteConfirmModal";
import AdminSelect from "@/components/admin/AdminSelect";
import { useAuth } from "@/contexts/AuthContext";
import { getUsers, updateUserRole, deleteUserAccount, getSuperAdminEmail } from "./actions";
import PremiumLoader from "@/components/PremiumLoader";
import PremiumSpinner from "@/components/PremiumSpinner";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: string;
  createdAt: string;
}

const ROLE_OPTIONS = [
  { value: "admin", label: "Admin" },
  { value: "shop_manager", label: "Shop Manager" },
  { value: "order_manager", label: "Order Manager" },
  { value: "customer", label: "Customer" },
];

const FILTER_ROLE_OPTIONS = [{ value: "all", label: "All Roles" }, ...ROLE_OPTIONS];

export default function CustomersPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");

  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [superAdminEmail, setSuperAdminEmail] = useState<string>("");
  const [deleteTarget, setDeleteTarget] = useState<{ uid: string; name: string } | null>(null);

  const isSuperAdmin = !!superAdminEmail && user?.email === superAdminEmail;

  useEffect(() => {
    if (!user) return;
    loadUsers();
  }, [user]);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const token = await user!.getIdToken();
      const [data, saEmail] = await Promise.all([
        getUsers(token),
        getSuperAdminEmail(token).catch(() => ""),
      ]);
      setUsers(data as UserProfile[]);
      setSuperAdminEmail(saEmail);
    } catch (err: any) {
      toast.error(err.message || "Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  const handleRoleChange = async (targetUid: string, newRole: string) => {
    try {
      setUpdatingId(targetUid);
      const token = await user!.getIdToken();
      await updateUserRole(targetUid, newRole, token);
      setUsers((prev) => prev.map((u) => (u.uid === targetUid ? { ...u, role: newRole } : u)));
      toast.success("Role updated");
      if (targetUid === user?.uid) {
        await user!.getIdToken(true);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to update role");
    } finally {
      setUpdatingId(null);
    }
  };

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      setDeletingId(deleteTarget.uid);
      const token = await user!.getIdToken();
      await deleteUserAccount(deleteTarget.uid, token);
      setUsers((prev) => prev.filter((u) => u.uid !== deleteTarget.uid));
      toast.success("User deleted");
      setDeleteTarget(null);
    } catch (err: any) {
      toast.error(err.message || "Failed to delete user");
    } finally {
      setDeletingId(null);
    }
  }, [deleteTarget, user]);

  const filteredUsers = users.filter((u) => {
    if (roleFilter !== "all" && (u.role || "customer") !== roleFilter) return false;
    if (search.trim()) {
      const s = search.toLowerCase();
      return u.email?.toLowerCase().includes(s) || u.displayName?.toLowerCase().includes(s);
    }
    return true;
  });

  if (loading && users.length === 0) {
    return <PremiumLoader />;
  }

  return (
    <div className="space-y-4 w-full min-w-0 pb-12">
      <DeleteConfirmModal
        isOpen={!!deleteTarget}
        title="Delete User?"
        message={`Are you sure you want to permanently delete "${deleteTarget?.name}"? This action cannot be undone.`}
        isDeleting={!!deletingId}
        onConfirm={confirmDelete}
        onCancel={() => {
          if (!deletingId) setDeleteTarget(null);
        }}
      />

      {/* ── Single-Row Search & Custom Role Filter ── */}
      <div className="bg-white rounded-2xl border border-gray-200/80 p-3 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
        <div className="relative flex-1 min-w-0">
          <Search
            size={15}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
          />
          <input
            type="text"
            placeholder="Search by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-10 pl-9 pr-9 bg-gray-50 border border-gray-200/80 focus:bg-white focus:border-black rounded-xl text-sm text-gray-900 placeholder:text-gray-400 outline-none transition-colors"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 cursor-pointer"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="w-full sm:w-44 shrink-0">
          <AdminSelect
            value={roleFilter}
            onChange={setRoleFilter}
            options={FILTER_ROLE_OPTIONS}
            placeholder="All Roles"
          />
        </div>
      </div>

      {/* ── Desktop CSS Grid (Overflow visible so role dropdowns never clip) ── */}
      <div className="hidden md:block bg-white border border-gray-200/80 rounded-2xl w-full">
        <div className="grid grid-cols-[minmax(0,1.8fr)_130px_170px_64px] items-center gap-4 px-5 py-3 bg-gray-50/70 border-b border-gray-100 rounded-t-2xl text-[11px] font-semibold text-gray-500">
          <div>User</div>
          <div>Joined</div>
          <div>Role</div>
          <div className="text-right">Actions</div>
        </div>

        <div className="divide-y divide-gray-100">
          {filteredUsers.length === 0 ? (
            <div className="px-6 py-14 text-center text-gray-400 text-sm">
              No users found matching your filters.
            </div>
          ) : (
            filteredUsers.map((u, idx) => {
              const roleLocked =
                updatingId === u.uid ||
                !isSuperAdmin ||
                u.uid === user?.uid ||
                u.email === superAdminEmail;
              const isLast = idx === filteredUsers.length - 1;

              return (
                <div
                  key={u.uid}
                  className={cn(
                    "grid grid-cols-[minmax(0,1.8fr)_130px_170px_64px] items-center gap-4 px-5 py-3.5 hover:bg-gray-50/50 transition-colors",
                    isLast && "rounded-b-2xl"
                  )}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-gray-100 text-gray-700 flex items-center justify-center shrink-0 text-xs font-bold">
                      {(u.displayName || u.email || "?")[0].toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900 text-sm flex items-center gap-1.5 truncate">
                        <span className="truncate">{u.displayName || "Unnamed User"}</span>
                        {u.email === superAdminEmail && (
                          <span title="Super Admin" className="shrink-0">
                            <Crown size={13} className="text-amber-500" />
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-gray-500 truncate">{u.email}</p>
                    </div>
                  </div>

                  <div className="text-xs text-gray-500 tabular-nums">
                    {new Date(u.createdAt).toLocaleDateString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                  </div>

                  <div className="w-full max-w-[160px]">
                    <AdminSelect
                      size="sm"
                      disabled={roleLocked}
                      value={u.role || "customer"}
                      onChange={(val) => handleRoleChange(u.uid, val)}
                      options={ROLE_OPTIONS}
                    />
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() =>
                        setDeleteTarget({ uid: u.uid, name: u.displayName || u.email })
                      }
                      disabled={
                        deletingId === u.uid ||
                        u.uid === user?.uid ||
                        u.email === superAdminEmail
                      }
                      className="w-8 h-8 rounded-lg border border-gray-200 bg-white text-gray-400 hover:text-red-600 hover:border-red-200 hover:bg-red-50 flex items-center justify-center transition-colors disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
                      title={u.uid === user?.uid ? "Cannot delete your own account" : "Delete user"}
                    >
                      {deletingId === u.uid ? <PremiumSpinner size="sm" /> : <Trash2 size={14} />}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Mobile Cards View ── */}
      <div className="md:hidden space-y-3">
        {filteredUsers.length === 0 ? (
          <div className="bg-white p-10 rounded-2xl border border-gray-200/80 text-center text-gray-400 text-sm">
            No users found.
          </div>
        ) : (
          filteredUsers.map((u) => {
            const roleLocked =
              updatingId === u.uid ||
              !isSuperAdmin ||
              u.uid === user?.uid ||
              u.email === superAdminEmail;

            return (
              <div
                key={u.uid}
                className="bg-white p-4 rounded-2xl border border-gray-200/80 space-y-3.5"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gray-100 text-gray-700 flex items-center justify-center font-bold text-sm shrink-0">
                    {(u.displayName || u.email || "?")[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 text-sm flex items-center gap-1.5 truncate">
                      <span className="truncate">{u.displayName || "Unnamed User"}</span>
                      {u.email === superAdminEmail && (
                        <Crown size={12} className="text-amber-500 shrink-0" />
                      )}
                    </p>
                    <p className="text-xs text-gray-500 truncate">{u.email}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setDeleteTarget({ uid: u.uid, name: u.displayName || u.email })
                    }
                    disabled={
                      deletingId === u.uid ||
                      u.uid === user?.uid ||
                      u.email === superAdminEmail
                    }
                    className="w-8 h-8 rounded-lg border border-gray-200 text-gray-400 hover:text-red-600 flex items-center justify-center disabled:opacity-35 cursor-pointer shrink-0"
                  >
                    {deletingId === u.uid ? <PremiumSpinner size="sm" /> : <Trash2 size={14} />}
                  </button>
                </div>

                <div className="flex items-center justify-between gap-3 pt-2.5 border-t border-gray-100">
                  <div>
                    <p className="text-[10px] font-medium text-gray-400">Joined</p>
                    <p className="text-xs font-semibold text-gray-700">
                      {new Date(u.createdAt).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </p>
                  </div>

                  <div className="w-40">
                    <AdminSelect
                      size="sm"
                      disabled={roleLocked}
                      value={u.role || "customer"}
                      onChange={(val) => handleRoleChange(u.uid, val)}
                      options={ROLE_OPTIONS}
                    />
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
