/**
 * How long a seat is held while the parent is paying.
 *
 * Ten minutes. It was thirty, which is generous to the person at the checkout
 * and expensive for everybody behind them: on a class that fills in the first
 * hour of registration opening, a handful of abandoned baskets can make the
 * class look full for half an hour while nobody is actually buying. Ten is long
 * enough to find a card and type it, short enough that an abandoned checkout
 * returns the seat while the next family is still on the page.
 *
 * ## The part that is not symmetrical any more
 *
 * The hold and Stripe's Checkout Session used to expire together, and the
 * comment here said they must. That is still the property we want and it can no
 * longer be arranged by setting one number, because **Stripe will not accept an
 * `expires_at` less than thirty minutes out**. Ask for ten and the API refuses
 * the session outright.
 *
 * So the session gets Stripe's floor and we close the gap ourselves: a job
 * expires the Stripe session once its hold has gone, which is what
 * `/api/jobs/sweep` does. A parent who wanders back to an abandoned tab finds a
 * dead checkout and a clear message, rather than a live payment page for a seat
 * that was handed to somebody else twenty minutes ago.
 *
 * And if that job never runs, the failure is still safe rather than silent:
 * fulfilment reclaims the seat when the payment lands, and if the class has
 * genuinely filled it enrols anyway and records `enrolled_over_capacity` for
 * staff. Somebody who has paid is never refused a place. See the webhook route.
 */
export const HOLD_MINUTES = 10;
export const HOLD_SECONDS = HOLD_MINUTES * 60;

/**
 * Stripe's own minimum lifetime for a Checkout Session, in minutes.
 *
 * Not a preference. The API rejects anything shorter, so this is the floor the
 * session is created at regardless of how short the hold is.
 */
export const STRIPE_MIN_SESSION_MINUTES = 30;

/** What to pass Stripe as `expires_at`, in epoch seconds. */
export function stripeSessionExpiry(from: Date = new Date()): number {
  const minutes = Math.max(HOLD_MINUTES, STRIPE_MIN_SESSION_MINUTES);
  return Math.floor(from.getTime() / 1000) + minutes * 60;
}
