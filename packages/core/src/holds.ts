/**
 * How long a seat is held while the parent is on Stripe's page.
 *
 * This is one constant on purpose. The hold and the Stripe Checkout session
 * must expire together: if the hold is shorter, a parent who takes their time
 * loses the seat while still holding a live payment page, and can pay for a
 * place that has already been given away. Fifteen minutes against a thirty
 * minute session was exactly that bug.
 */
export const HOLD_MINUTES = 30;
export const HOLD_SECONDS = HOLD_MINUTES * 60;
