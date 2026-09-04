"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

/**
 * The page a parent lands on after Stripe.
 *
 * It does NOT say "you're registered" on arrival, because the redirect from
 * Stripe proves only that the browser came back. The webhook is what proves
 * payment, so this polls the order until fulfilment actually happened. Usually
 * that is under a second and the parent never reads this text.
 */
function Confirming() {
  const params = useSearchParams();
  const orderId = params.get("order");
  // Derived from the URL at first render rather than set from inside the
  // effect: a missing order id is knowable immediately, not an event.
  const [state, setState] = useState<"waiting" | "done" | "slow" | "error">(
    orderId ? "waiting" : "error",
  );
  const [portalToken, setPortalToken] = useState<string | null>(null);

  useEffect(() => {
    if (!orderId) return;

    let attempts = 0;
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      attempts++;
      try {
        const res = await fetch(`/api/orders/${orderId}`, { cache: "no-store" });
        const data = await res.json();
        if (data.fulfilled) {
          setPortalToken(data.portalToken);
          setState("done");
          return;
        }
      } catch {
        // keep waiting; a failed poll is not a failed payment
      }
      if (attempts > 15) return setState("slow");
      setTimeout(tick, 1000);
    };

    tick();
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-5 py-24 text-center">
      {state === "waiting" && (
        <>
          <div
            aria-hidden
            className="h-11 w-11 animate-spin rounded-full border-4 border-green-200 border-t-green-700"
            style={{ animationDuration: "700ms" }}
          />
          <h1 className="mt-6 font-display text-3xl font-bold text-green-900">
            Confirming your payment
          </h1>
          <p className="mt-3 text-ink-soft">
            One moment. We are waiting for Stripe to confirm, which is the only thing we
            treat as proof of payment.
          </p>
        </>
      )}

      {state === "done" && (
        <div className="kc-enter">
          <span className="kc-eyebrow">Registered</span>
          <h1 className="mt-5 font-display text-4xl font-bold text-green-900">
            Your keiki are <span className="kc-highlight">in</span>
          </h1>
          <p className="mt-4 text-ink-soft">
            We have emailed your confirmation with a link to manage your registrations. No
            account or password needed, the link is enough.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            {portalToken && (
              <Link href={`/portal?t=${portalToken}`} className="kc-btn kc-btn-primary">
                View my registrations
              </Link>
            )}
            <Link href="/" className="kc-btn kc-btn-quiet">
              Browse more classes
            </Link>
          </div>
        </div>
      )}

      {state === "slow" && (
        <>
          <h1 className="font-display text-3xl font-bold text-green-900">
            Still confirming
          </h1>
          <p className="mt-3 text-ink-soft">
            Your payment went through and your seats are held. Confirmation is taking longer
            than usual, and it will complete on its own. Nothing is lost and you do not need
            to pay again.
          </p>
        </>
      )}

      {state === "error" && (
        <>
          <h1 className="font-display text-3xl font-bold text-green-900">
            We could not find that order
          </h1>
          <Link href="/" className="kc-btn kc-btn-quiet mt-6">
            Back to classes
          </Link>
        </>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Confirming />
    </Suspense>
  );
}
