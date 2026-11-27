"use server";

import { sendEmail } from "@/lib/email/sendEmail";
import { storage } from "@/lib/storage";
import {
  WelcomeEmail,
  OrderConfirmation,
  NewOrderAdminNotification,
  OrderStatusUpdate,
  PaymentConfirmed,
} from "@/emails/renderers/index";
import { verifyAdminAction } from "@/lib/auth-server";
import { logSecurityEvent } from "@/lib/security/audit-log";

/**
 * Every exported function in a `"use server"` file is a publicly reachable HTTP
 * endpoint in Next.js App Router. All email Server Actions therefore require
 * verified administrator authentication. Internal server workflows call
 * `sendEmail` directly on the server rather than exposing open Server Actions.
 */
export async function dispatchWelcomeEmail(email: string, name: string, idToken?: string) {
  const admin = await verifyAdminAction(idToken);
  if (!admin) {
    await logSecurityEvent({
      action: "email_action.welcome",
      severity: "warn",
      outcome: "denied",
      reason: "Unauthorized Server Action invocation",
    });
    return { success: false, error: "Unauthorized" };
  }

  try {
    const settings = await storage.getSettings();
    const storeName = settings?.storeName || "Afra Tech Point";
    await sendEmail({
      to: email,
      subject: `Welcome to ${storeName}!`,
      template: WelcomeEmail,
      props: {
        customerName: name,
        logoUrl: settings?.logoUrl,
        shopUrl: settings?.shopUrl,
      },
    });
    return { success: true };
  } catch {
    return { success: false, error: "Failed to send email" };
  }
}

export async function dispatchOrderEmails(
  email: string,
  orderId: string,
  customerName: string,
  items: any[],
  total: number,
  shippingAddress: any,
  orderDate: string,
  discount: number = 0,
  paymentMethod: string = "Cash on Delivery",
  idToken?: string
) {
  const admin = await verifyAdminAction(idToken);
  if (!admin) {
    await logSecurityEvent({
      action: "email_action.order_confirmation",
      severity: "warn",
      outcome: "denied",
      reason: "Unauthorized Server Action invocation",
    });
    return { success: false, error: "Unauthorized" };
  }

  try {
    const settings = await storage.getSettings();
    const adminEmail =
      settings?.adminEmail || process.env.ADMIN_EMAIL || process.env.SMTP_USER || "";
    const logoUrl = settings?.logoUrl;
    const shopUrl = settings?.shopUrl;

    await Promise.allSettled([
      sendEmail({
        to: email,
        subject: `Your Order Confirmation #${orderId.slice(0, 8).toUpperCase()}`,
        template: OrderConfirmation,
        props: {
          customerName,
          orderId,
          items,
          total,
          deliveryCharge: settings?.deliveryCharge,
          discount,
          paymentMethod,
          shippingAddress,
          orderDate,
          logoUrl,
          shopUrl,
        },
      }),
      ...(adminEmail
        ? [
            sendEmail({
              to: adminEmail,
              subject: `[ACTION REQUIRED] New Order #${orderId.slice(0, 8).toUpperCase()}`,
              template: NewOrderAdminNotification,
              props: {
                customerName,
                orderId,
                items,
                total,
                deliveryCharge: settings?.deliveryCharge,
                discount,
                paymentMethod,
                shippingAddress,
                logoUrl,
                shopUrl,
              },
            }),
          ]
        : []),
    ]);
    return { success: true };
  } catch {
    return { success: false, error: "Failed to dispatch order emails" };
  }
}

export async function dispatchOrderStatusUpdate(
  email: string,
  orderId: string,
  status: string,
  trackingInfo?: string,
  idToken?: string
) {
  const admin = await verifyAdminAction(idToken);
  if (!admin) return { success: false, error: "Unauthorized" };

  try {
    const settings = await storage.getSettings();
    const capitalizedStatus = status.charAt(0).toUpperCase() + status.slice(1);
    await sendEmail({
      to: email,
      subject: `Order #${orderId.slice(0, 8).toUpperCase()} is now ${capitalizedStatus}`,
      template: OrderStatusUpdate,
      props: {
        orderId,
        status,
        trackingInfo,
        logoUrl: settings?.logoUrl,
        shopUrl: settings?.shopUrl,
      },
    });
    return { success: true };
  } catch {
    return { success: false, error: "Failed to send status email" };
  }
}

export async function dispatchPaymentConfirmed(
  email: string,
  orderId: string,
  customerName: string,
  idToken?: string
) {
  const admin = await verifyAdminAction(idToken);
  if (!admin) return { success: false, error: "Unauthorized" };

  try {
    const settings = await storage.getSettings();
    const order = await storage.getOrderById(orderId);
    if (!order) return { success: false, error: "Order not found" };

    await sendEmail({
      to: email,
      subject: `Payment Confirmed for Order #${orderId.slice(0, 8).toUpperCase()}`,
      template: PaymentConfirmed,
      props: {
        orderId,
        customerName,
        amount: order?.totalAmount || order?.total,
        items: order?.items,
        total: order?.totalAmount || order?.total,
        deliveryCharge: order?.deliveryCharge,
        discount: order?.discount || 0,
        paymentMethod: order?.payment?.method || "Online Payment",
        logoUrl: settings?.logoUrl,
        shopUrl: settings?.shopUrl,
      },
    });
    return { success: true };
  } catch {
    return { success: false, error: "Failed to send payment email" };
  }
}
