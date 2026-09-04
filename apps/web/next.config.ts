import type { NextConfig } from "next";

/**
 * Security headers.
 *
 * None of these are exotic. They are the set that costs nothing and closes the
 * cheap attacks, and their absence is the sort of thing a security review finds
 * in the first five minutes.
 *
 * There is deliberately no Content-Security-Policy here. A CSP that is wrong is
 * worse than none, because it either breaks the app or lulls you into thinking
 * you have one, and Next injects inline scripts whose nonces have to be threaded
 * through middleware to do it properly. That is a real task with a real test
 * pass, not a config line, so it is listed as work rather than faked.
 */
const securityHeaders = [
  // Do not let a browser guess that an uploaded .txt is really a script.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // No framing at all. This app has no legitimate embedder, and clickjacking a
  // "cancel my registration" button is a real thing to prevent.
  { key: "X-Frame-Options", value: "DENY" },
  // Send the origin to third parties, never the full path. Paths here contain
  // family and class ids.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // We ask for none of these, so say so.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  // HSTS is only meaningful over TLS, which local development is not. Kept
  // because the deployment target is HTTPS and forgetting it there is worse.
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
];

const nextConfig: NextConfig = {
  // The domain lives in a sibling workspace package and ships as TypeScript
  // source rather than a build artefact, so Next has to compile it like our own
  // code. One less build step between changing a rule and seeing it apply.
  transpilePackages: ["@keiki/core"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
