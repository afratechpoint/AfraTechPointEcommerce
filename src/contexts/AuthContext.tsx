"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "@/lib/firebase/client";
import {
  signInWithEmail,
  signUpWithEmail,
  signInWithGoogle,
  logOut,
  sendPasswordReset,
} from "@/lib/firebase/auth";
import { syncUserToFirestore } from "@/app/actions/auth";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  role: string | null;
  isAdmin: boolean;
  isShopManager: boolean;
  isOrderManager: boolean;
  displayName: string | null;
  photoURL: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  googleSignIn: () => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [photoURL, setPhotoURL] = useState<string | null>(null);

  const adminEmails = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || "")
    .toLowerCase()
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  const isAdminByEmail = user?.email ? adminEmails.includes(user.email.trim().toLowerCase()) : false;

  const isAdmin = role === "admin" || isAdminByEmail;
  const isShopManager = role === "shop_manager";
  const isOrderManager = role === "order_manager";

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        try {
          const idToken = await firebaseUser.getIdToken();
          const result = await syncUserToFirestore(
            idToken,
            firebaseUser.displayName || "",
            firebaseUser.photoURL || ""
          );

          if (result.success && result.userData) {
            setDisplayName(result.userData.displayName || firebaseUser.displayName || null);
            setPhotoURL(result.userData.photoURL || firebaseUser.photoURL || null);
            setRole(result.userData.role || "customer");
          } else {
            setDisplayName(firebaseUser.displayName);
            setPhotoURL(firebaseUser.photoURL);
            setRole("customer");
          }

          const tokenResult = await firebaseUser.getIdTokenResult();
          const claimRole = tokenResult.claims.role as string | undefined;
          if (claimRole !== (result.userData?.role || "customer")) {
            firebaseUser.getIdToken(true).catch(() => {});
          }
        } catch {
          setRole("customer");
          setDisplayName(firebaseUser.displayName);
          setPhotoURL(firebaseUser.photoURL);
        }
      } else {
        setRole(null);
        setDisplayName(null);
        setPhotoURL(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    await signInWithEmail(email, password);
  };

  const signUp = async (name: string, email: string, password: string) => {
    const cred = await signUpWithEmail(name, email, password);
    if (cred.user) {
      cred.user
        .getIdToken()
        .then((idToken) => syncUserToFirestore(idToken, name, cred.user.photoURL || ""))
        .catch(() => {});
    }
  };

  const googleSignIn = async () => {
    const cred = await signInWithGoogle();
    if (cred.user) {
      cred.user
        .getIdToken()
        .then((idToken) =>
          syncUserToFirestore(idToken, cred.user.displayName || "", cred.user.photoURL || "")
        )
        .catch(() => {});
    }
  };

  const logout = async () => {
    const currentUser = auth.currentUser;
    if (currentUser && typeof window !== "undefined") {
      // 1. Remove cached personal profile data from shared browser localStorage
      try {
        localStorage.removeItem(`afra_profile_${currentUser.uid}`);
      } catch {}

      // 2. Unregister active FCM push token on the server so another user on the same device
      // does not receive previous user/admin notifications
      try {
        const savedPushToken = sessionStorage.getItem("afra_fcm_token");
        if (savedPushToken) {
          const idToken = await currentUser.getIdToken().catch(() => null);
          if (idToken) {
            await fetch("/api/push-token", {
              method: "DELETE",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${idToken}`,
              },
              body: JSON.stringify({ token: savedPushToken }),
            }).catch(() => {});
          }
          sessionStorage.removeItem("afra_fcm_token");
        }
      } catch {}
    }

    await logOut();
  };

  const resetPassword = async (email: string) => {
    await sendPasswordReset(email);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        role,
        isAdmin,
        isShopManager,
        isOrderManager,
        displayName,
        photoURL,
        signIn,
        signUp,
        googleSignIn,
        logout,
        resetPassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
