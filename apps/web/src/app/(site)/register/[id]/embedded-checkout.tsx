"use client";

import { loadStripe } from "@stripe/stripe-js";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { HoldTimer } from "./hold-timer";

/**
 * Stripe's checkout, in our page.
 *
 * The redirect this replaces was the single biggest seam in the parent journey.
 * Somebody has just typed their child's name, grade, birthday and any medical
 * notes, and pressing the last button threw them onto another company's website
 * to finish. On a phone that reads as "something went wrong", and the common
 * reaction is to stop rather than to pay.
 *
 * **Nothing about the security position changes.** The card fields live inside
 * Stripe's own iframe on Stripe's own origin, so this application still never
 * sees a card number and is still out of PCI scope for card data. The line items
 * are still built on the server from price ids we stored ourselves, so nothing
 * the browser sends can influence what is charged. The webhook is still what
 * fulfils the order: this component is a way of collecting a card, not a source
 * of truth about whether anybody paid.
 *
 * The publishable key is loaded once at module scope rather than per render.
 * `loadStripe` injects a script tag, and calling it inside a component would ask
 * for a new one on every re-render.
 */
const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

export function InlineCheckout({
  clientSecret,
  holdExpiresAt,
}: {
  clientSecret: string;
  holdExpiresAt?: string | null;
}) {
  return (
    <div className="kc-checkout">
      <div className="kc-checkout-head">
        <div>
          <p className="kc-checkout-title">Payment</p>
          <p className="kc-checkout-note">
            Card details go straight to Stripe. We never see or store them.
          </p>
        </div>
      </div>

      {/* Above the card fields, because it is the constraint they are working
          inside. Underneath the form it would be a footnote about a deadline
          they have already missed. */}
      <HoldTimer expiresAt={holdExpiresAt ?? null} />

      <EmbeddedCheckoutProvider stripe={stripePromise} options={{ clientSecret }}>
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  );
}
