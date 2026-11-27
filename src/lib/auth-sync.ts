import { adminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import { createNotificationInFirestore } from "@/lib/firebase/server_firestore";
import { sendEmail } from "@/lib/email/sendEmail";
import { WelcomeEmail } from "@/emails/renderers/index";
import { storage } from "@/lib/storage";
import { isSafeHttpUrl } from "@/lib/security/validation";

/**
 * Internal server-only user profile synchronization helper.
 * Callers MUST have already verified `uid` and `email` via Firebase Admin Auth.
 * Never overwrites `role`.
 */
export async function syncVerifiedUserRecord(
  uid: string,
  email: string,
  displayName?: string,
  photoURL?: string
) {
  const cleanName = typeof displayName === "string" ? displayName.trim().slice(0, 100) : "";
  const cleanPhoto =
    typeof photoURL === "string" && isSafeHttpUrl(photoURL) ? photoURL.trim().slice(0, 1024) : "";

  const userRef = adminDb.collection("users").doc(uid);
  const snap = await userRef.get();

  const updateData: Record<string, unknown> = {
    email: email.trim().toLowerCase(),
    lastLogin: FieldValue.serverTimestamp(),
  };
  if (cleanName) updateData.displayName = cleanName;
  if (cleanPhoto) updateData.photoURL = cleanPhoto;

  if (!snap.exists) {
    await userRef.set({
      ...updateData,
      uid,
      role: "customer",
      createdAt: FieldValue.serverTimestamp(),
    });

    createNotificationInFirestore({
      type: "new_user",
      title: "New User Registered",
      message: `${cleanName || "A new user"} (${email}) just created an account.`,
      recipient: "admin",
      link: `/admin/customers`,
    }).catch(() => {});

    createNotificationInFirestore({
      type: "welcome",
      title: "Welcome to Afra Tech Point!",
      message: `Hello ${cleanName || "there"}, welcome to Afra Tech Point! Explore our latest products and deals.`,
      recipient: uid,
      link: `/shop`,
    }).catch(() => {});

    if (email) {
      storage
        .getSettings()
        .then((settings: any) =>
          sendEmail({
            to: email,
            subject: `Welcome to ${settings?.storeName || "Afra Tech Point"}!`,
            template: WelcomeEmail,
            props: {
              customerName: cleanName || "Customer",
              logoUrl: settings?.logoUrl,
              shopUrl: settings?.shopUrl,
            },
          })
        )
        .catch(() => {});
    }
  } else {
    await userRef.update(updateData);
  }

  const finalSnap = await userRef.get();
  const finalData = finalSnap.data();

  return {
    displayName: finalData?.displayName || cleanName || "",
    photoURL: finalData?.photoURL || cleanPhoto || "",
    role: finalData?.role || "customer",
  };
}
