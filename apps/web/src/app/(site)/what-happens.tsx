/**
 * What the system does on its own, once a parent presses pay.
 *
 * This replaces the mascot film that used to sit here. The film was well made
 * and it was the wrong thing in the wrong place: a looping cartoon of a turtle
 * took the full width of the section explaining how registration works, and it
 * explained nothing. A parent scrolling this page is deciding whether to trust
 * a stranger with a card number and a child's medical notes, and a mascot is
 * not an argument.
 *
 * So the space says what actually happens, which is the part that is genuinely
 * different from the form they are used to. Every step here is a real thing in
 * the system: the seat hold with its real duration, the Stripe webhook, the
 * outbox row written in the same transaction as the enrolment, the roster the
 * office sees. Nothing is aspirational.
 *
 * Deliberately a server component with no animation. The old block pulled in a
 * video library on a marketing page; this is markup. It also means the whole
 * thing is visible in the first frame rather than waiting on an observer, and
 * there is nothing to disable under `prefers-reduced-motion` because there is
 * nothing moving.
 */
import { HOLD_MINUTES } from "@keiki/core/holds";

const STEPS = [
  {
    when: "Instantly",
    title: "The seat is yours",
    body: `Before any money moves, the place is taken out of the class and held for ${HOLD_MINUTES} minutes. Nobody else can be sold it while you finish, and you can see the timer counting down.`,
  },
  {
    when: "At checkout",
    title: "Stripe takes the card",
    body: "The card form is Stripe's, on the same page. We never see a card number, and the charge is confirmed back to us rather than being assumed from the browser.",
  },
  {
    when: "Seconds later",
    title: "The confirmation is written, then sent",
    body: "The email is recorded in the same instant as the enrolment, then delivered by a separate job. A mail outage delays your confirmation. It cannot lose your place.",
  },
  {
    when: "Same moment",
    title: "The office already knows",
    body: "The roster, the seat count and the payment record all update from the one action. Nothing is copied between systems overnight, so nobody has to reconcile anything by hand.",
  },
];

export function WhatHappens() {
  return (
    <ol className="kc-flow">
      {STEPS.map((s) => (
        <li key={s.title} className="kc-flow-step">
          <span className="kc-flow-when">{s.when}</span>
          <h3 className="kc-flow-title">{s.title}</h3>
          <p className="kc-flow-body">{s.body}</p>
        </li>
      ))}
    </ol>
  );
}
