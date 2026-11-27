/** @type {import('next').NextConfig} */
const os = require("os");

const lanOrigins = Object.values(os.networkInterfaces())
  .flat()
  .filter((iface) => iface && iface.family === "IPv4" && !iface.internal)
  .map((iface) => iface.address);

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,

  // Allow any active LAN IP on this machine to load /_next/* assets on other devices in local dev
  allowedDevOrigins: Array.from(new Set(["192.168.10.62", ...lanOrigins])),

  // ── Compiler Optimizations ────────────────────────────────────────────
  compiler: {
    removeConsole: process.env.NODE_ENV === "production" ? { exclude: ["error", "warn"] } : false,
  },

  // ── Security + Caching Headers ────────────────────────────────────────
  async headers() {
    const isProd = process.env.NODE_ENV === "production";

    const securityHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-DNS-Prefetch-Control", value: "on" },
      ...(isProd
        ? [
            {
              key: "Strict-Transport-Security",
              value: "max-age=63072000; includeSubDomains; preload",
            },
          ]
        : []),
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
      },
      // Required for Firebase Google OAuth popup sign-in flow
      { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
      ...(isProd
        ? [
            {
              key: "Content-Security-Policy",
              value: [
                "default-src 'self'",
                // Next.js hydration + Firebase SDKs (no 'unsafe-eval' in production)
                "script-src 'self' 'unsafe-inline' https://www.gstatic.com https://apis.google.com",
                "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
                "font-src 'self' data: https://fonts.gstatic.com",
                "img-src 'self' data: blob: https://i.ibb.co https://i.ibb.co.com https://images.unsplash.com https://firebasestorage.googleapis.com https://*.googleusercontent.com https://ik.imagekit.io https://afratechpoint.shop",
                "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://*.firebaseapp.com wss://*.firebaseio.com",
                "frame-src 'self' https://accounts.google.com https://*.firebaseapp.com",
                "worker-src 'self' blob:",
                "frame-ancestors 'self'",
                "object-src 'none'",
                "base-uri 'self'",
                "form-action 'self'",
                "upgrade-insecure-requests",
              ].join("; "),
            },
          ]
        : []),
    ];

    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        // Never allow shared proxies/CDNs to cache private Admin or Customer Account routes
        source: "/admin/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store, no-cache, must-revalidate" },
        ],
      },
      {
        source: "/account/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store, no-cache, must-revalidate" },
        ],
      },
      {
        source: "/checkout/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store, no-cache, must-revalidate" },
        ],
      },
      {
        source: "/_next/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: isProd
              ? "public, max-age=31536000, immutable"
              : "no-store, no-cache, must-revalidate",
          },
        ],
      },
      {
        source: "/fonts/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store, no-cache, must-revalidate" }],
      },
    ];
  },

  // ── Image Optimization ────────────────────────────────────────────────
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "i.ibb.co" },
      { protocol: "https", hostname: "i.ibb.co.com" },
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "firebasestorage.googleapis.com" },
      { protocol: "https", hostname: "*.googleusercontent.com" },
      { protocol: "https", hostname: "ik.imagekit.io" },
    ],
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 2592000,
    deviceSizes: [390, 768, 1280, 1440],
    imageSizes: [64, 128, 256, 384],
    dangerouslyAllowSVG: false,
    contentDispositionType: "attachment",
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },

  // ── Bundle Optimizations ──────────────────────────────────────────────
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "framer-motion",
      "@firebase/app",
      "@firebase/auth",
      "@firebase/firestore",
      "sonner",
    ],
  },

  devIndicators: false,
};

module.exports = nextConfig;
