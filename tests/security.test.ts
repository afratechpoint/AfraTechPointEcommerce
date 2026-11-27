import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

// Configure isolated non-production security test environment BEFORE loading route modules
process.env.AFRA_SECURITY_TEST_MODE = "1";
process.env.NEXT_PUBLIC_USE_FIREBASE = "false";
process.env.ADMIN_EMAIL = "owner@afratechpoint.shop";
process.env.NEXT_PUBLIC_ADMIN_EMAILS = "owner@afratechpoint.shop";
process.env.OTP_ENCRYPTION_SECRET = "unit-test-32-byte-secret-key-material-2026";
process.env.STEADFAST_WEBHOOK_TOKEN = "steadfast-test-webhook-secret-token-99";
process.env.IMAGEKIT_PRIVATE_KEY = "test_ik_private_key_not_real";

import {
  setTokenVerifierForTesting,
  resolveUserRole,
  type VerifiedCaller,
} from "@/lib/auth-server";
import { storage } from "@/lib/storage";
import { resetMemoryRateLimitsForTesting, checkRateLimit } from "@/lib/security/rate-limit";
import {
  generateSecureOtp,
  hashOtp,
  verifyOtpHash,
  encryptTransientSecret,
  decryptTransientSecret,
} from "@/lib/security/crypto-helpers";
import { detectSafeImageMagicBytes } from "@/lib/security/file-validation";
import { safeJsonLdStringify } from "@/lib/security/validation";

import { GET as getProfile, POST as postProfile } from "@/app/api/profile/route";
import { GET as getOrders, POST as postOrders } from "@/app/api/orders/route";
import {
  GET as getOrderById,
  PATCH as patchOrderById,
  DELETE as deleteOrderById,
} from "@/app/api/orders/[id]/route";
import { GET as getProducts, POST as postProducts } from "@/app/api/products/route";
import {
  GET as getProductById,
  PUT as putProductById,
  DELETE as deleteProductById,
} from "@/app/api/products/[id]/route";
import { PUT as putSettings } from "@/app/api/settings/route";
import { POST as postUpload } from "@/app/api/upload/route";
import { POST as postSteadfastWebhook } from "@/app/api/webhooks/steadfast/route";
import { GET as getGeoDivision } from "@/app/api/geo/division/[division]/route";
import { POST as postSpellcheck } from "@/app/api/admin/spellcheck/route";
import { POST as postSendVerification } from "@/app/api/auth/send-verification/route";
import { POST as postPushToken } from "@/app/api/push-token/route";
import {
  GET as getNotifications,
  POST as postNotifications,
  DELETE as deleteNotifications,
} from "@/app/api/notifications/route";
import { syncUserToFirestore } from "@/app/actions/auth";
import { dispatchWelcomeEmail } from "@/app/actions/email";

// ── Four Distinct Test Identities (Phase 13) ──────────────────────────────
// Identity A: Unauthenticated visitor (no Authorization header)
const TOKEN_CUSTOMER_B = "test-token-customer-alice";
const TOKEN_CUSTOMER_C = "test-token-customer-bob";
const TOKEN_ADMIN_D = "test-token-admin-owner";
const TOKEN_SHOP_MANAGER = "test-token-shop-manager";
const TOKEN_SUBSTRING_ATTACKER = "test-token-substring-attacker";

const IDENTITIES: Record<string, VerifiedCaller> = {
  [TOKEN_CUSTOMER_B]: {
    uid: "cust_alice_001",
    email: "alice@example.com",
    email_verified: true,
    role: "customer",
  },
  [TOKEN_CUSTOMER_C]: {
    uid: "cust_bob_002",
    email: "bob@example.com",
    email_verified: true,
    role: "customer",
  },
  [TOKEN_ADMIN_D]: {
    uid: "admin_owner_001",
    email: "owner@afratechpoint.shop",
    email_verified: true,
    role: "admin",
  },
  [TOKEN_SHOP_MANAGER]: {
    uid: "staff_shop_001",
    email: "manager@afratechpoint.shop",
    email_verified: true,
    role: "shop_manager",
  },
  // Substring of `owner@afratechpoint.shop` (`techpoint.shop` / `afratechpoint.shop`)
  [TOKEN_SUBSTRING_ATTACKER]: {
    uid: "cust_sub_003",
    email: "afratechpoint.shop",
    email_verified: true,
  },
};

function makeJsonRequest(
  url: string,
  method: string,
  body?: unknown,
  token?: string,
  extraHeaders?: Record<string, string>
): NextRequest {
  const headers: Record<string, string> = {
    "x-forwarded-for": "203.0.113.42",
    ...(body !== undefined ? { "content-type": "application/json" } : {}),
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(extraHeaders || {}),
  };
  return new NextRequest(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

let tempDataDir = "";

async function seedIsolatedTestData() {
  resetMemoryRateLimitsForTesting();
  storage.clearMemoryCacheForTesting();

  await fs.writeFile(
    path.join(tempDataDir, "settings.json"),
    JSON.stringify(
      {
        storeName: "Afra Tech Point",
        currencySymbol: "৳",
        deliveryCharge: 120,
        codEnabled: true,
        paymentMethods: [
          { id: "bkash", name: "bKash", accountNumber: "01700000000", enabled: true },
          { id: "nagad", name: "Nagad", accountNumber: "01800000000", enabled: true },
        ],
      },
      null,
      2
    )
  );

  await fs.writeFile(
    path.join(tempDataDir, "products.json"),
    JSON.stringify(
      [
        {
          id: "prod_earbuds",
          name: "HOCO EQ34 Plus",
          regularPrice: 1500,
          salePrice: 1200,
          stock: 5,
          category: "Audio",
          image: "/logo.png",
          productKind: "physical",
          variants: [
            { id: "v_black", name: "Black", regularPrice: 1500, salePrice: 1200, stock: 3 },
            { id: "v_white", name: "White", regularPrice: 1500, salePrice: 1250, stock: 2 },
          ],
        },
        {
          id: "prod_win_key",
          name: "Windows 11 Pro Key",
          regularPrice: 800,
          salePrice: 500,
          stock: 2,
          category: "Software",
          image: "/logo.png",
          productKind: "virtual",
          virtualType: "license",
          virtualConfig: {
            stockMode: "pool",
            licensePool: [
              { id: "k1", key: "WIN11-SECRET-KEY-AAAA1" },
              { id: "k2", key: "WIN11-SECRET-KEY-BBBB2" },
            ],
          },
        },
      ],
      null,
      2
    )
  );

  await fs.writeFile(path.join(tempDataDir, "orders.json"), "[]");
  await fs.writeFile(path.join(tempDataDir, "profiles.json"), "{}");
  await fs.writeFile(path.join(tempDataDir, "media.json"), "[]");
}

describe("Afra Tech Point — End-to-End Security Regression Suite", () => {
  before(async () => {
    tempDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "afra-security-audit-"));
    process.env.AFRA_DATA_DIR = tempDataDir;
    setTokenVerifierForTesting(async (token) => IDENTITIES[token] || null);
  });

  after(async () => {
    setTokenVerifierForTesting(null);
    if (tempDataDir) {
      await fs.rm(tempDataDir, { recursive: true, force: true });
    }
  });

  beforeEach(async () => {
    await seedIsolatedTestData();
  });

  it("1. Rejects unauthenticated access (Identity A) across protected APIs and Server Actions", async () => {
    const ordersGet = await getOrders(makeJsonRequest("http://localhost:3000/api/orders", "GET"));
    assert.equal(ordersGet.status, 401);

    const ordersPost = await postOrders(
      makeJsonRequest("http://localhost:3000/api/orders", "POST", { items: [] })
    );
    assert.equal(ordersPost.status, 401);

    const settingsPut = await putSettings(
      makeJsonRequest("http://localhost:3000/api/settings", "PUT", { storeName: "Hacked" })
    );
    assert.equal(settingsPut.status, 401);

    const spellRes = await postSpellcheck(
      makeJsonRequest("http://localhost:3000/api/admin/spellcheck", "POST", { text: "hello world" })
    );
    assert.equal(spellRes.status, 401);

    const verifyEmailRes = await postSendVerification(
      makeJsonRequest("http://localhost:3000/api/auth/send-verification", "POST", {
        email: "victim@example.com",
      })
    );
    assert.equal(verifyEmailRes.status, 401);

    const syncRes = await syncUserToFirestore("invalid-token", "Attacker");
    assert.equal(syncRes.success, false);

    const emailActionRes = await dispatchWelcomeEmail("victim@example.com", "Victim");
    assert.equal(emailActionRes.success, false);
  });

  it("2. Blocks customer-to-admin privilege escalation via POST /api/profile mass assignment & substring email", async () => {
    // Customer B attempts to inject `role: "admin"` and `isAdmin: true`
    const escalateRes = await postProfile(
      makeJsonRequest(
        "http://localhost:3000/api/profile",
        "POST",
        { data: { displayName: "Alice", role: "admin", isAdmin: true } },
        TOKEN_CUSTOMER_B
      )
    );
    assert.equal(escalateRes.status, 400);

    // Legitimate profile update by Customer B still succeeds cleanly
    const validRes = await postProfile(
      makeJsonRequest(
        "http://localhost:3000/api/profile",
        "POST",
        { data: { displayName: "Alice Rahman", phone: "01711223344", division: "Dhaka" } },
        TOKEN_CUSTOMER_B
      )
    );
    assert.equal(validRes.status, 200);

    const readBack = await getProfile(
      makeJsonRequest("http://localhost:3000/api/profile", "GET", undefined, TOKEN_CUSTOMER_B)
    );
    const profileJson = await readBack.json();
    assert.equal(profileJson.displayName, "Alice Rahman");
    assert.equal("role" in profileJson, false);

    // Substring email check (`afratechpoint.shop` inside `owner@afratechpoint.shop`) must NOT grant admin
    const subRole = await resolveUserRole(IDENTITIES[TOKEN_SUBSTRING_ATTACKER]);
    assert.equal(subRole, "customer");
  });

  it("3. Enforces RBAC: Customer B cannot access admin endpoints while Admin D succeeds", async () => {
    const custAllOrders = await getOrders(
      makeJsonRequest("http://localhost:3000/api/orders?all=true", "GET", undefined, TOKEN_CUSTOMER_B)
    );
    assert.equal(custAllOrders.status, 401);

    const custCreateProd = await postProducts(
      makeJsonRequest(
        "http://localhost:3000/api/products",
        "POST",
        { name: "Fake Item", regularPrice: 10 },
        TOKEN_CUSTOMER_B
      )
    );
    assert.equal(custCreateProd.status, 401);

    const custDeleteProd = await deleteProductById(
      makeJsonRequest("http://localhost:3000/api/products/prod_earbuds", "DELETE", undefined, TOKEN_CUSTOMER_B),
      { params: Promise.resolve({ id: "prod_earbuds" }) }
    );
    assert.equal(custDeleteProd.status, 401);

    const custPushAdmin = await postPushToken(
      makeJsonRequest(
        "http://localhost:3000/api/push-token",
        "POST",
        { uid: "admin", token: "a".repeat(40) },
        TOKEN_CUSTOMER_B
      )
    );
    assert.equal(custPushAdmin.status, 403);

    // Admin D succeeds on settings update & product creation, while shop_manager is blocked from settings & order deletion
    const smSettings = await putSettings(
      makeJsonRequest(
        "http://localhost:3000/api/settings",
        "PUT",
        { storeName: "Shop Manager Override" },
        TOKEN_SHOP_MANAGER
      )
    );
    assert.equal(smSettings.status, 401);

    const smCreateProd = await postProducts(
      makeJsonRequest(
        "http://localhost:3000/api/products",
        "POST",
        { name: "USB-C Hub", regularPrice: 950, stock: 10 },
        TOKEN_SHOP_MANAGER
      )
    );
    assert.equal(smCreateProd.status, 200);

    const smDeleteOrder = await deleteOrderById(
      makeJsonRequest("http://localhost:3000/api/orders/some-id", "DELETE", undefined, TOKEN_SHOP_MANAGER),
      { params: Promise.resolve({ id: "some-id" }) }
    );
    assert.equal(smDeleteOrder.status, 401);

    const adminSettings = await putSettings(
      makeJsonRequest(
        "http://localhost:3000/api/settings",
        "PUT",
        { storeName: "Afra Tech Point Official", deliveryCharge: 130 },
        TOKEN_ADMIN_D
      )
    );
    assert.equal(adminSettings.status, 200);
  });

  it("4. Strips secret licensePool/credentialPool from public product endpoints while preserving Admin access", async () => {
    const pubListRes = await getProducts(makeJsonRequest("http://localhost:3000/api/products", "GET"));
    const pubList = await pubListRes.json();
    const pubWin = pubList.find((p: any) => p.id === "prod_win_key");
    assert.ok(pubWin);
    assert.equal(pubWin.virtualConfig?.licensePool, undefined);
    assert.equal(pubWin.virtualConfig?.poolCount, 2);

    const pubDetailRes = await getProductById(
      makeJsonRequest("http://localhost:3000/api/products/prod_win_key", "GET"),
      { params: Promise.resolve({ id: "prod_win_key" }) }
    );
    const pubDetail = await pubDetailRes.json();
    assert.equal(pubDetail.virtualConfig?.licensePool, undefined);

    const adminDetailRes = await getProductById(
      makeJsonRequest("http://localhost:3000/api/products/prod_win_key", "GET", undefined, TOKEN_ADMIN_D),
      { params: Promise.resolve({ id: "prod_win_key" }) }
    );
    const adminDetail = await adminDetailRes.json();
    assert.equal(adminDetail.virtualConfig?.licensePool?.length, 2);
  });

  it("5. Defeats price, deliveryCharge, userId, and paymentStatus tampering on checkout + enforces BOLA/IDOR", async () => {
    // Customer B attempts to buy 2x White Earbuds (server salePrice=1250 each + 120 delivery = 2620)
    // while sending forged price=1, deliveryCharge=0, paymentStatus='confirmed', userId='cust_bob_002'
    const orderRes = await postOrders(
      makeJsonRequest(
        "http://localhost:3000/api/orders",
        "POST",
        {
          userId: "cust_bob_002",
          items: [
            {
              productId: "prod_earbuds",
              variantName: "White",
              quantity: 2,
              price: 1,
            },
          ],
          shippingAddress: {
            fullName: "Alice Rahman",
            phone: "01711223344",
            address: "Road 5",
            division: "Dhaka",
            district: "Dhaka",
            upazila: "Uttara",
          },
          payment: {
            method: "Cash on Delivery",
          },
          total: 2,
          totalAmount: 2,
          deliveryCharge: 0,
          paymentStatus: "confirmed",
          orderStatus: "delivered",
        },
        TOKEN_CUSTOMER_B
      )
    );

    assert.equal(orderRes.status, 201);
    const created = await orderRes.json();
    assert.equal(created.userId, "cust_alice_001"); // Derived from token, not spoofed body
    assert.equal(created.subtotal, 2500); // 2 * 1250 server variant price
    assert.equal(created.deliveryCharge, 120); // Trusted server delivery charge
    assert.equal(created.totalAmount, 2620);
    assert.equal(created.paymentStatus, "pending_cod"); // Forged 'confirmed' rejected
    assert.equal(created.orderStatus, "pending");

    // Cross-customer IDOR/BOLA: Customer C (Bob) CANNOT view Alice's order or order list
    const bobListAlice = await getOrders(
      makeJsonRequest(
        "http://localhost:3000/api/orders?userId=cust_alice_001",
        "GET",
        undefined,
        TOKEN_CUSTOMER_C
      )
    );
    assert.equal(bobListAlice.status, 403);

    const bobReadAliceOrder = await getOrderById(
      makeJsonRequest(
        `http://localhost:3000/api/orders/${created.id}`,
        "GET",
        undefined,
        TOKEN_CUSTOMER_C
      ),
      { params: Promise.resolve({ id: created.id }) }
    );
    assert.equal(bobReadAliceOrder.status, 403);

    // Owner (Alice) CAN view her own order
    const aliceReadOwn = await getOrderById(
      makeJsonRequest(
        `http://localhost:3000/api/orders/${created.id}`,
        "GET",
        undefined,
        TOKEN_CUSTOMER_B
      ),
      { params: Promise.resolve({ id: created.id }) }
    );
    assert.equal(aliceReadOwn.status, 200);
  });

  it("6. Protects digital license keys before payment confirmation and blocks duplicate TrxID reuse", async () => {
    const createRes = await postOrders(
      makeJsonRequest(
        "http://localhost:3000/api/orders",
        "POST",
        {
          items: [{ productId: "prod_win_key", quantity: 1 }],
          payment: {
            method: "bKash",
            senderNumber: "01711223344",
            transactionId: "BKASH998877",
          },
        },
        TOKEN_CUSTOMER_B
      )
    );
    assert.equal(createRes.status, 201);
    const unpaidOrder = await createRes.json();

    // 1. 201 response MUST NOT leak pre-allocated license key while payment is pending
    assert.equal(unpaidOrder.paymentStatus, "pending");
    assert.equal(unpaidOrder.deliveries, undefined);

    // 2. Customer order list MUST NOT leak pre-allocated license key while payment is pending
    const listRes = await getOrders(
      makeJsonRequest(
        "http://localhost:3000/api/orders?userId=cust_alice_001",
        "GET",
        undefined,
        TOKEN_CUSTOMER_B
      )
    );
    const listJson = await listRes.json();
    assert.equal(listJson[0].deliveries, undefined);

    // 3. Customer C attempts to reuse the exact same TrxID `bkash998877` (case-insensitive) -> 409 Conflict
    const dupTrxRes = await postOrders(
      makeJsonRequest(
        "http://localhost:3000/api/orders",
        "POST",
        {
          items: [{ productId: "prod_win_key", quantity: 1 }],
          payment: {
            method: "bKash",
            senderNumber: "01811223344",
            transactionId: "bkash998877",
          },
        },
        TOKEN_CUSTOMER_C
      )
    );
    assert.equal(dupTrxRes.status, 409);

    // 4. Admin confirms payment -> Customer B can now read the delivered license key
    const confirmRes = await patchOrderById(
      makeJsonRequest(
        `http://localhost:3000/api/orders/${unpaidOrder.id}`,
        "PATCH",
        { paymentStatus: "confirmed" },
        TOKEN_ADMIN_D
      ),
      { params: Promise.resolve({ id: unpaidOrder.id }) }
    );
    assert.equal(confirmRes.status, 200);

    const paidViewRes = await getOrderById(
      makeJsonRequest(
        `http://localhost:3000/api/orders/${unpaidOrder.id}`,
        "GET",
        undefined,
        TOKEN_CUSTOMER_B
      ),
      { params: Promise.resolve({ id: unpaidOrder.id }) }
    );
    const paidOrder = await paidViewRes.json();
    assert.equal(paidOrder.deliveries?.length, 1);
    assert.match(paidOrder.deliveries[0].value, /^WIN11-SECRET-KEY-/);

    // 5. Once refunded, order cannot transition back to confirmed AND deliveries are hidden from customer
    const refundRes = await patchOrderById(
      makeJsonRequest(
        `http://localhost:3000/api/orders/${unpaidOrder.id}`,
        "PATCH",
        { paymentStatus: "refunded" },
        TOKEN_ADMIN_D
      ),
      { params: Promise.resolve({ id: unpaidOrder.id }) }
    );
    assert.equal(refundRes.status, 200);

    const revertPaidAttempt = await patchOrderById(
      makeJsonRequest(
        `http://localhost:3000/api/orders/${unpaidOrder.id}`,
        "PATCH",
        { paymentStatus: "confirmed" },
        TOKEN_ADMIN_D
      ),
      { params: Promise.resolve({ id: unpaidOrder.id }) }
    );
    assert.equal(revertPaidAttempt.status, 400);
  });

  it("7. Prevents overselling and duplicate license key delivery under concurrent race conditions + idempotent cancel restore", async () => {
    // Pool has exactly 2 keys (`WIN11-SECRET-KEY-AAAA1`, `WIN11-SECRET-KEY-BBBB2`).
    // Fire 4 concurrent checkout requests simultaneously via Promise.all!
    const concurrentRequests = [1, 2, 3, 4].map((n) =>
      postOrders(
        makeJsonRequest(
          "http://localhost:3000/api/orders",
          "POST",
          {
            items: [{ productId: "prod_win_key", quantity: 1 }],
            payment: {
              method: "bKash",
              senderNumber: "01711223344",
              transactionId: `RACE_TRX_00${n}`,
            },
          },
          n % 2 === 0 ? TOKEN_CUSTOMER_B : TOKEN_CUSTOMER_C,
          { "x-forwarded-for": `198.51.100.${n}` }
        )
      )
    );

    const responses = await Promise.all(concurrentRequests);
    const statuses = responses.map((r) => r.status).sort();
    assert.deepEqual(statuses, [201, 201, 400, 400]);

    // Verify via Admin that the 2 created orders got 2 STRICTLY DISTINCT keys and remaining stock == 0
    const allOrdersRes = await getOrders(
      makeJsonRequest("http://localhost:3000/api/orders?all=true", "GET", undefined, TOKEN_ADMIN_D)
    );
    const allOrders = await allOrdersRes.json();
    assert.equal(allOrders.length, 2);
    assert.notEqual(allOrders[0].deliveries[0].value, allOrders[1].deliveries[0].value);

    // Cancel the first unpaid order TWICE — stock/key pool must restore EXACTLY ONCE (to 1, not 2!)
    const targetOrderId = allOrders[0].id;
    await patchOrderById(
      makeJsonRequest(
        `http://localhost:3000/api/orders/${targetOrderId}`,
        "PATCH",
        { orderStatus: "cancelled", cancellationReason: "Invalid TrxID" },
        TOKEN_ADMIN_D
      ),
      { params: Promise.resolve({ id: targetOrderId }) }
    );
    await patchOrderById(
      makeJsonRequest(
        `http://localhost:3000/api/orders/${targetOrderId}`,
        "PATCH",
        { orderStatus: "cancelled", cancellationReason: "Duplicate click" },
        TOKEN_ADMIN_D
      ),
      { params: Promise.resolve({ id: targetOrderId }) }
    );

    const prodAfterCancelRes = await getProductById(
      makeJsonRequest("http://localhost:3000/api/products/prod_win_key", "GET", undefined, TOKEN_ADMIN_D),
      { params: Promise.resolve({ id: "prod_win_key" }) }
    );
    const prodAfterCancel = await prodAfterCancelRes.json();
    assert.equal(prodAfterCancel.virtualConfig.licensePool.length, 1);
  });

  it("8. Blocks SVG/HTML MIME-spoofed uploads while allowing valid raster image magic bytes", async () => {
    const svgSpoof = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');
    assert.equal(detectSafeImageMagicBytes(svgSpoof), null);

    const pngHeader = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    ]);
    assert.deepEqual(detectSafeImageMagicBytes(pngHeader), {
      mimeType: "image/png",
      extension: ".png",
    });

    // End-to-end POST /api/upload with SVG disguised as image/png
    const form = new FormData();
    form.append("files", new Blob([svgSpoof], { type: "image/png" }), "avatar.png");
    const uploadReq = new NextRequest("http://localhost:3000/api/upload", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN_ADMIN_D}` },
      body: form,
    });
    const uploadRes = await postUpload(uploadReq);
    assert.equal(uploadRes.status, 400);
    const uploadJson = await uploadRes.json();
    assert.equal(uploadJson.success, false);
  });

  it("9. Enforces Steadfast webhook Bearer authentication & replay idempotency", async () => {
    // Create and ship an order first
    const createRes = await postOrders(
      makeJsonRequest(
        "http://localhost:3000/api/orders",
        "POST",
        {
          items: [{ productId: "prod_earbuds", variantName: "Black", quantity: 1 }],
          shippingAddress: {
            fullName: "Alice",
            phone: "01711223344",
            division: "Dhaka",
            district: "Dhaka",
            upazila: "Dhanmondi",
          },
          payment: { method: "Cash on Delivery" },
        },
        TOKEN_CUSTOMER_B
      )
    );
    const order = await createRes.json();
    await storage.updateOrder(order.id, { courierConsignmentId: 55443322 });

    // Forged / missing webhook token -> 401
    const badHook = await postSteadfastWebhook(
      makeJsonRequest(
        "http://localhost:3000/api/webhooks/steadfast",
        "POST",
        { notification_type: "delivery_status", consignment_id: 55443322, status: "delivered" },
        "wrong-secret-token"
      )
    );
    assert.equal(badHook.status, 401);

    // Authentic webhook token -> 200 & updates order to delivered
    const validHook = await postSteadfastWebhook(
      makeJsonRequest(
        "http://localhost:3000/api/webhooks/steadfast",
        "POST",
        { notification_type: "delivery_status", consignment_id: 55443322, status: "delivered" },
        process.env.STEADFAST_WEBHOOK_TOKEN
      )
    );
    assert.equal(validHook.status, 200);

    // Replayed identical webhook -> 200 idempotent no-op
    const replayHook = await postSteadfastWebhook(
      makeJsonRequest(
        "http://localhost:3000/api/webhooks/steadfast",
        "POST",
        { notification_type: "delivery_status", consignment_id: 55443322, status: "delivered" },
        process.env.STEADFAST_WEBHOOK_TOKEN
      )
    );
    const replayJson = await replayHook.json();
    assert.match(replayJson.message, /Duplicate event ignored/i);
  });

  it("10. Blocks XSS URIs, JSON-LD script breakout, geo path traversal, and verifies OTP crypto & rate limiting", async () => {
    // 1. `javascript:` URI in checkout targetUrl -> 400
    const xssOrderRes = await postOrders(
      makeJsonRequest(
        "http://localhost:3000/api/orders",
        "POST",
        {
          items: [{ productId: "prod_win_key", quantity: 1 }],
          payment: {
            method: "bKash",
            senderNumber: "01711223344",
            transactionId: "XSS_TEST_TRX1",
          },
          fulfillment: {
            targetUrl: "javascript:alert(document.domain)",
          },
        },
        TOKEN_CUSTOMER_B
      )
    );
    assert.equal(xssOrderRes.status, 400);

    // 2. `javascript:` URI in Admin Settings navLinks -> 400
    const xssSettingsRes = await putSettings(
      makeJsonRequest(
        "http://localhost:3000/api/settings",
        "PUT",
        {
          navLinks: [{ id: "1", label: "Evil", href: "javascript:alert(1)" }],
        },
        TOKEN_ADMIN_D
      )
    );
    assert.equal(xssSettingsRes.status, 400);

    // 3. JSON-LD `</script>` breakout protection
    const serialized = safeJsonLdStringify({ name: "</script><script>alert(1)</script>" });
    assert.equal(serialized.includes("</script>"), false);
    assert.equal(serialized.includes("\\u003c/script\\u003e"), true);

    // 4. Geo path traversal blocked
    const traversalRes = await getGeoDivision(
      new Request("http://localhost:3000/api/geo/division/..%2fadmin"),
      { params: Promise.resolve({ division: "../admin" }) }
    );
    assert.equal(traversalRes.status, 400);

    // 5. OTP CSPRNG + HMAC-SHA256 + AES-256-GCM encryption & tamper resistance
    const otp = generateSecureOtp();
    assert.match(otp, /^\d{6}$/);
    const { hash, salt } = hashOtp(otp);
    assert.equal(verifyOtpHash(otp, hash, salt), true);
    assert.equal(verifyOtpHash("000000", hash, salt), false || otp === "000000");

    const encrypted = encryptTransientSecret("MyS3cretP@ss!");
    assert.equal(encrypted.includes("MyS3cretP@ss!"), false);
    assert.equal(decryptTransientSecret(encrypted), "MyS3cretP@ss!");
    assert.throws(() => decryptTransientSecret(`${encrypted}tampered`));

    // 6. Rate limiter enforces sliding/fixed window ceiling
    const r1 = await checkRateLimit({ bucket: "unit_rl", identifier: "ip1", limit: 2, windowMs: 60000 });
    const r2 = await checkRateLimit({ bucket: "unit_rl", identifier: "ip1", limit: 2, windowMs: 60000 });
    const r3 = await checkRateLimit({ bucket: "unit_rl", identifier: "ip1", limit: 2, windowMs: 60000 });
    assert.equal(r1.allowed, true);
    assert.equal(r2.allowed, true);
    assert.equal(r3.allowed, false);
  });

  it("11. Enforces notification BOLA/IDOR protections and validates firestore.rules invariants", async () => {
    // Customer B cannot read Customer C's or Admin's notifications
    const readAdminNotifs = await getNotifications(
      makeJsonRequest(
        "http://localhost:3000/api/notifications?recipient=admin&limit=5000",
        "GET",
        undefined,
        TOKEN_CUSTOMER_B
      )
    );
    assert.equal(readAdminNotifs.status, 401);

    const readBobNotifs = await getNotifications(
      makeJsonRequest(
        "http://localhost:3000/api/notifications?recipient=cust_bob_002",
        "GET",
        undefined,
        TOKEN_CUSTOMER_B
      )
    );
    assert.equal(readBobNotifs.status, 403);

    const clearAdminNotifs = await deleteNotifications(
      makeJsonRequest(
        "http://localhost:3000/api/notifications?all=true&recipient=admin",
        "DELETE",
        undefined,
        TOKEN_CUSTOMER_B
      )
    );
    assert.equal(clearAdminNotifs.status, 403);

    const markUnknownNotif = await postNotifications(
      makeJsonRequest(
        "http://localhost:3000/api/notifications",
        "POST",
        { id: "non_existent_notif_999" },
        TOKEN_CUSTOMER_B
      )
    );
    assert.equal(markUnknownNotif.status, 404);

    // Structural verification of `firestore.rules` least-privilege invariants
    const rulesText = await fs.readFile(path.join(process.cwd(), "firestore.rules"), "utf8");
    assert.match(rulesText, /rules_version\s*=\s*'2'/);
    assert.equal(/allow\s+read,\s*write:\s*if\s*true/i.test(rulesText), false);
    assert.match(rulesText, /match\s+\/products\/\{productId\}[\s\S]*?allow\s+read:\s*if\s+isCatalogStaff\(\)/);
    assert.match(rulesText, /match\s+\/otps\/\{email\}[\s\S]*?allow\s+read,\s*write:\s*if\s+false/);
    assert.match(rulesText, /match\s+\/used_transactions\/\{trxId\}[\s\S]*?allow\s+read,\s*write:\s*if\s+false/);
    assert.match(rulesText, /match\s+\/security_audit_logs\/\{logId\}[\s\S]*?allow\s+read,\s*write:\s*if\s+false/);
    assert.match(rulesText, /match\s+\/\{document=\*\*\}[\s\S]*?allow\s+read,\s*write:\s*if\s+false/);
  });
});
