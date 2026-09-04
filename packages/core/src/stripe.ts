import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) throw new Error("STRIPE_SECRET_KEY is not set");

/**
 * Server only. This module must never be imported from a client component:
 * the secret key has no NEXT_PUBLIC_ prefix precisely so a build that tried
 * would fail rather than quietly ship a key to the browser.
 */
export const stripe = new Stripe(key, {
  apiVersion: "2026-08-26.dahlia",
  appInfo: { name: "Keiki Coders registration" },
  maxNetworkRetries: 2,
});

export const isTestMode = key.startsWith("sk_test_");

// Re-exported for the server side, which already imports this module anyway.
// Client components must import from lib/money directly.
export { formatMoney } from "./money";
