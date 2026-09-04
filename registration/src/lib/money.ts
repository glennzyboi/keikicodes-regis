/**
 * Money formatting, and nothing else.
 *
 * This lives apart from lib/stripe.ts on purpose. That module constructs the
 * Stripe client at import time and throws without the secret key, so anything
 * importing it is server only. Formatting a number is not, and a shared UI
 * component that needed it was dragging the whole server module into the client
 * bundle. Splitting it means the import graph enforces the boundary instead of
 * a comment asking people to be careful.
 */

/** Money is integer minor units everywhere. Never a float, never a string. */
export function formatMoney(cents: number, currency = "usd") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}
