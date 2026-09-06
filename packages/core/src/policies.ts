/**
 * What a family is agreeing to, and which version of it.
 *
 * Their form has a checkbox reading "you acknowledge and agree to our
 * participation policies, safety guidelines, and cancellation policy". What
 * gets stored is that the box was ticked. Not which policy, not when it last
 * changed, not what it said on the day.
 *
 * That is fine until the first family disputes a cancellation fee, at which
 * point the only honest answer is "we do not know what you agreed to". So the
 * version is a constant here, it travels into the consents table with a
 * timestamp, and changing the wording means bumping it. A parent who agreed to
 * v1 has agreed to v1 for ever, and the app can tell who has not yet seen v2.
 */
export const POLICY_VERSION = "2026-09-07";

export type PolicySection = { heading: string; body: string };

export const PARTICIPATION_POLICY: PolicySection[] = [
  {
    heading: "Attendance and campus",
    body:
      "Classes run on your child's own school campus, immediately after the school day. " +
      "Your child must be enrolled at that school for the whole term. If your child leaves " +
      "the school, tell us and we will refund the sessions that have not run.",
  },
  {
    heading: "Pick up and after school care",
    body:
      "Tell us if your child is in an after school care programme such as A+ or W+. " +
      "We hand children back to that programme rather than to the gate, and getting this " +
      "wrong is the one mistake we will not risk.",
  },
  {
    heading: "Sessions we cancel",
    body:
      "School holidays and closures are published with the class before you register. " +
      "If we cancel a session for any other reason we will tell you by email the same day, " +
      "and either add a make up week or refund that session.",
  },
  {
    heading: "Dropping from a class",
    body:
      "You can drop your child from a class at any time from your account. The seat is " +
      "freed straight away and the enrolment ends. No refund is processed automatically — " +
      "if you believe you are owed one, use the cancellation option or contact the office.",
  },
  {
    heading: "Cancelling and requesting a refund",
    body:
      "If you would like a refund for sessions that have not yet run, choose \"Request " +
      "cancellation & refund\" from your account. The office will review your request, " +
      "confirm the amount, and send the refund back to the card that paid. This usually " +
      "takes a few working days.",
  },
  {
    heading: "Photographs",
    body:
      "We ask for a head shot so instructors can tell who is in their class on the first " +
      "day. It is visible only to Keiki Coders staff, it is never used in marketing, and " +
      "you can ask us to delete it at any time.",
  },
];

/** The one line that sits next to the checkbox. */
export const CONSENT_SUMMARY =
  "I agree to the participation policies, safety guidelines and cancellation policy.";
