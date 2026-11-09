import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import { contentSecurityPolicy } from "./src/lib/security/csp";
import { shouldUploadSentrySourceMaps } from "./src/lib/config/sentry-build";

const isDev = process.env.NODE_ENV === "development";
const hasSentryUpload = shouldUploadSentrySourceMaps(process.env);

const nextConfig: NextConfig = {
  // Native browser View Transitions for client-side navigations — GPU-composited
  // crossfades that stay smooth at 60fps. Next 16.2 wires this into <Link> routing.
  experimental: {
    viewTransition: true,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options",           value: "DENY" },
          { key: "X-Content-Type-Options",     value: "nosniff" },
          { key: "Referrer-Policy",            value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy",         value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security",  value: "max-age=31536000; includeSubDomains; preload" },
          {
            key: "Content-Security-Policy",
            value: contentSecurityPolicy(isDev),
          },
        ],
      },
      {
        source: "/tesseract/(.*)",
        headers: [
          // Not immutable: a short TTL bounds how long a browser can hold a
          // mismatched worker/wasm/model pair after a tesseract.js upgrade.
          // A mismatch degrades OCR to manual entry rather than breaking the page.
          { key: "Cache-Control", value: "public, max-age=86400" },
        ],
      },
    ];
  },
};

// Upload source maps only for a fully configured production deployment. The
// plugin deletes them after upload so stack traces improve without publishing
// application source maps.
export default withSentryConfig(nextConfig, {
  silent: true,
  org: hasSentryUpload ? process.env.SENTRY_ORG : undefined,
  project: hasSentryUpload ? process.env.SENTRY_PROJECT : undefined,
  authToken: hasSentryUpload ? process.env.SENTRY_AUTH_TOKEN : undefined,
  sourcemaps: { disable: !hasSentryUpload, deleteSourcemapsAfterUpload: true },
  webpack: { treeshake: { removeDebugLogging: true } },
});
