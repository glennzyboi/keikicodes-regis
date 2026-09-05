/**
 * The reason lists, and nothing else.
 *
 * Deliberately its own file with no imports at all. The forms that offer these
 * options are client components, and importing them from `schedule.ts` would
 * pull `notify.ts`, then `db.ts`, then the Postgres driver into the browser
 * bundle. That has already happened twice in this codebase, once with a Stripe
 * money formatter and once with a grade helper, and both times it surfaced as
 * `Can't resolve 'fs'` at build time rather than as anything to do with the
 * change that caused it.
 */

/** Why a class date is not running. */
export const CANCEL_REASONS = [
  { code: "holiday", label: "Public holiday or school break" },
  { code: "instructor_unavailable", label: "Instructor unavailable" },
  { code: "campus_closed", label: "Campus closed" },
  { code: "weather", label: "Weather" },
  { code: "facility", label: "Room or facility unavailable" },
  { code: "low_enrollment", label: "Too few students" },
  { code: "other", label: "Something else" },
] as const;

export type CancelReasonCode = (typeof CANCEL_REASONS)[number]["code"];

export const CANCEL_REASON_LABELS: Record<string, string> = Object.fromEntries(
  CANCEL_REASONS.map((r) => [r.code, r.label]),
);

/**
 * Why a family is leaving.
 *
 * Their form has nowhere to say this at all, and ours used to write the literal
 * string "requested by parent", which records nothing. A code the office can
 * count turns "eleven cancellations this term" into "eleven, seven of them
 * because the time clashed with something", which is a thing you can act on.
 *
 * Ordered by how often it will genuinely be the answer, not alphabetically, so
 * the common case is the first thing a parent reads. "Another reason" is last
 * and requires them to write something, because a reason picker whose easiest
 * option is a shrug collects shrugs.
 */
export const PARENT_CANCEL_REASONS = [
  { code: "schedule_conflict", label: "The time no longer works for us" },
  { code: "child_not_enjoying", label: "My child is not enjoying it" },
  { code: "wrong_class", label: "It is not the right class for them" },
  { code: "illness", label: "Illness or a family reason" },
  { code: "moved_away", label: "We are leaving the school" },
  { code: "cost", label: "Cost" },
  { code: "other", label: "Another reason" },
] as const;

export type ParentCancelReasonCode = (typeof PARENT_CANCEL_REASONS)[number]["code"];

export const PARENT_CANCEL_REASON_LABELS: Record<string, string> = Object.fromEntries(
  PARENT_CANCEL_REASONS.map((r) => [r.code, r.label]),
);

/**
 * Why a child stopped coming.
 *
 * A drop and a cancellation are different events and the build spec names them
 * separately. A cancellation is a family asking, waiting on a decision, and
 * usually ending in money going back. A drop is the office recording a fact:
 * the child stopped attending. Often nobody asked for anything, and often there
 * is no refund because they came to eight of the ten sessions.
 *
 * These read as things an office writes down after a phone call, because that
 * is when this gets recorded.
 */
export const DROP_REASONS = [
  { code: "stopped_attending", label: "Stopped attending, no reason given" },
  { code: "schedule_conflict", label: "Clashed with something else" },
  { code: "not_enjoying", label: "Not enjoying it" },
  { code: "wrong_level", label: "Wrong level for them" },
  { code: "illness", label: "Illness or a family reason" },
  { code: "left_school", label: "Left the school" },
  { code: "behaviour", label: "Asked to leave the class" },
  { code: "other", label: "Something else" },
] as const;

export type DropReasonCode = (typeof DROP_REASONS)[number]["code"];

export const DROP_REASON_LABELS: Record<string, string> = Object.fromEntries(
  DROP_REASONS.map((r) => [r.code, r.label]),
);
