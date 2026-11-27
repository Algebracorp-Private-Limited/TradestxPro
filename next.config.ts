import type { NextConfig } from "next";

// Content-Security-Policy: the browser only talks to this origin (market data, brokers and AI providers are
// called server-side). 'unsafe-inline' scripts are required by the theme bootstrap and Next.js inline
// payloads; 'unsafe-eval' only in development (hot reload). Vercel preview deployments also allow the
// Vercel toolbar origin.
const dev = process.env.NODE_ENV !== "production";
const preview = process.env.VERCEL_ENV === "preview";
const vercelLive = preview ? " https://vercel.live" : "";
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}${vercelLive}`,
  `style-src 'self' 'unsafe-inline'${vercelLive}`,
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${vercelLive}${preview ? " wss://ws-us3.pusher.com" : ""}${dev ? " ws:" : ""}`,
  "worker-src 'self' blob:",
  `frame-src 'self'${vercelLive}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(dev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
