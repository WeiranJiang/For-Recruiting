import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Page CSP (nonce-based) is set per request in src/proxy.ts.
 * API responses are JSON/PDF only, so they get a lock-down CSP here.
 */
const apiCsp = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

const common = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["@electric-sql/pglite", "googleapis"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      // Pages: common headers here, CSP with a per-request nonce from src/proxy.ts.
      { source: "/((?!api/).*)", headers: common },
      // API (except the resume PDF, which sets its own sandboxed CSP so the browser PDF viewer works).
      { source: "/api/((?!resume).*)", headers: [...common, { key: "Content-Security-Policy", value: apiCsp }] },
      { source: "/api/resume", headers: common },
      // API responses carry personal data: never cache.
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "private, no-store" }] },
    ];
  },
};

export default nextConfig;
