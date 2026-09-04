import { z } from "zod";

/**
 * Validation for Server Actions.
 *
 * The API routes were already validated with zod. Server Actions were not: they
 * read FormData and passed it straight to SQL. postgres.js parameterises
 * everything, so injection was never the risk, but three real ones remained:
 *
 *   1. A malformed uuid reaches Postgres, which raises, and a typo becomes a
 *      500 instead of a polite refusal.
 *   2. No length cap. A note field with no maximum is an invitation to store a
 *      few megabytes of someone's clipboard.
 *   3. Values that must be one of a set were only checked by a database CHECK
 *      constraint, so a bad one surfaced as a crash rather than a message.
 *
 * A Server Action is a public HTTP endpoint. The form in front of it is a
 * convenience for honest users and no protection at all, so every action
 * validates as if the form did not exist.
 */

export const uuid = z.string().uuid();

/**
 * Remove control characters.
 *
 * They render as nothing, so they are invisible in a form, and they are the
 * usual carrier for terminal escape tricks when text later reaches a log or a
 * CSV. Tab, newline and carriage return are deliberately kept: a note about a
 * phone call has paragraphs in it.
 *
 * Written as a scan rather than a regex because the escape sequences for this
 * particular character class are easy to get subtly wrong, and a silently
 * wrong one would strip nothing.
 */
export function stripControl(value: string) {
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    const printable =
      code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
    if (printable) out += ch;
  }
  return out;
}

/** Free text a human typed. Trimmed, capped, and never empty by accident. */
export function text(max: number, min = 1) {
  return z
    .string()
    .transform(stripControl)
    .transform((v) => v.trim())
    .refine((v) => v.length >= min, `Please write at least ${min} characters`)
    .refine((v) => v.length <= max, `Please keep this under ${max} characters`);
}

export function optionalText(max: number) {
  return z
    .string()
    .transform(stripControl)
    .transform((v) => v.trim())
    .refine((v) => v.length <= max, `Please keep this under ${max} characters`)
    .transform((v) => (v.length === 0 ? null : v));
}

/** An ISO date, and a real one. "2026-02-31" parses as a string and is not a day. */
export const isoDate = z
  .string()
  .regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/, "Use the date picker")
  .refine((v) => {
    const [y, m, d] = v.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }, "That date does not exist");

/** Money as minor units. Never a float, never negative, never absurd. */
export const cents = z.coerce
  .number()
  .int("Amounts are whole cents")
  .min(0)
  .max(1_000_000, "That is larger than any class costs");

/**
 * Only ever redirect within this site.
 *
 * An open redirect on a login page is how a convincing phishing link gets built
 * out of a domain families already trust. Protocol relative URLs are the case
 * people forget, because they start with a slash and look internal.
 */
export function safeNext(next: unknown, fallback = "/portal") {
  if (typeof next !== "string") return fallback;
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//")) return fallback;
  if (next.includes("\\")) return fallback;
  return next;
}

/**
 * Parse FormData against a schema.
 *
 * Returns a discriminated result rather than throwing, because a Server Action
 * that throws shows the user a generic error boundary, and "please check the
 * date" is more useful than "something went wrong".
 */
export function parseForm<T extends z.ZodTypeAny>(
  schema: T,
  formData: FormData,
): { ok: true; data: z.infer<T> } | { ok: false; error: string } {
  const raw: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    // Files are never expected here. Accepting one silently would mean a Blob
    // reaching a query parameter.
    if (typeof value === "string") raw[key] = value;
  }

  const result = schema.safeParse(raw);
  if (result.success) return { ok: true, data: result.data };

  const first = result.error.issues[0];
  return { ok: false, error: first?.message ?? "That does not look right." };
}

// ---------------------------------------------------------------------------
// The schemas themselves, one per action, kept together so the shape of every
// public entry point in the app can be read in one place.
// ---------------------------------------------------------------------------

export const SignInForm = z.object({
  email: z.string().trim().email("That does not look like an email address").max(200),
  password: z.string().min(1).max(200),
  next: z.string().optional(),
});

export const SignUpForm = z.object({
  email: z.string().trim().email("That does not look like an email address").max(200),
  password: z.string().min(8, "Please use at least eight characters").max(200),
  fullName: text(120, 2),
  next: z.string().optional(),
});

export const ProfileForm = z.object({
  fullName: text(120, 2),
  // Deliberately permissive. Phone numbers are written a dozen ways and
  // rejecting a valid one is worse than storing an odd one.
  phone: optionalText(40),
});

export const EnrollmentIdForm = z.object({ enrollmentId: uuid });

export const ApproveCancellationForm = z.object({
  enrollmentId: uuid,
  refundCents: cents,
});

export const CancelSessionForm = z.object({
  sessionId: uuid,
  note: optionalText(500),
});

export const RescheduleSessionForm = z.object({
  sessionId: uuid,
  newDate: isoDate,
  note: optionalText(500),
});

export const SupportNoteForm = z.object({
  parentId: uuid,
  childId: z
    .union([uuid, z.literal("")])
    .optional()
    .transform((v) => (v ? v : null)),
  kind: z.enum(["note", "call", "email", "complaint", "resolved"]),
  body: text(4000, 2),
});

export const NotificationIdForm = z.object({ notificationId: uuid });

export const TransferForm = z.object({
  enrollmentId: uuid,
  toClassId: uuid,
});

// ---------------------------------------------------------------------------
// The catalogue.
//
// These are the forms that stop the office having to ask a developer to add a
// class. They are the ones with real consequences behind them: a capacity below
// the number of children already enrolled, a price change after money has
// moved, a schedule change that quietly relocates somebody's Tuesday. The
// checks that matter are in the action and in the database; these are the first
// gate, not the only one.
// ---------------------------------------------------------------------------

/** Kindergarten is 0, matching the column and sorting correctly. */
export const grade = z.coerce.number().int().min(0).max(12);

const optionalGrade = z
  .union([grade, z.literal("")])
  .optional()
  .transform((v) => (v === "" || v === undefined ? null : Number(v)));

/** "15:15" from a time input, stored as "15:15:00". */
export const clockTime = z
  .string()
  .regex(/^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/, "Use the time picker")
  .transform((v) => (v.length === 5 ? `${v}:00` : v));

const optionalUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === "" || /^https?:\/\//i.test(v), "Links must start with http or https")
  .transform((v) => (v === "" ? null : v));

/** A checkbox that is either present or absent in FormData. */
const checkbox = z
  .union([z.literal("on"), z.literal("true"), z.literal("1"), z.literal("")])
  .optional()
  .transform((v) => v === "on" || v === "true" || v === "1");

export const SchoolForm = z.object({
  schoolId: z.union([uuid, z.literal("")]).optional(),
  name: text(120, 2),
  kind: z.enum(["public", "private", "charter", ""]).transform((v) => (v ? v : null)),
  area: optionalText(80),
  timezone: text(60, 3),
  logoUrl: optionalUrl,
  externalRegistrationUrl: optionalUrl,
  active: checkbox,
});

export const ProgramForm = z.object({
  programId: z.union([uuid, z.literal("")]).optional(),
  name: text(160, 2),
  track: optionalText(60),
  subject: optionalText(80),
  description: optionalText(4000),
  imageUrl: optionalUrl,
  active: checkbox,
});

export const TermForm = z.object({
  termId: z.union([uuid, z.literal("")]).optional(),
  name: text(60, 3),
  startsOn: isoDate,
  endsOn: isoDate,
  isCurrent: checkbox,
});

export const OfferingForm = z
  .object({
    offeringId: z.union([uuid, z.literal("")]).optional(),
    schoolId: uuid,
    programId: uuid,
    termId: uuid,
    title: text(160, 2),
    weekday: z.coerce.number().int().min(0).max(6),
    startTime: clockTime,
    endTime: clockTime,
    firstSessionDate: isoDate,
    lastSessionDate: isoDate,
    capacity: z.coerce.number().int().min(1, "A class needs at least one seat").max(500),
    priceCents: z
      .union([cents, z.literal("")])
      .optional()
      .transform((v) => (v === "" || v === undefined ? null : Number(v))),
    registrationMode: z.enum(["keiki_coders", "external"]),
    externalRegistrationUrl: optionalUrl,
    gradeMin: optionalGrade,
    gradeMax: optionalGrade,
    location: optionalText(160),
    specialNotes: optionalText(2000),
    status: z.enum(["draft", "published", "closed"]),
    // One date per line, which is how somebody pastes a term calendar.
    blackoutDates: z
      .string()
      .max(2000)
      .optional()
      .transform((v) =>
        (v ?? "")
          .split(/[\n,]/)
          .map((s) => s.trim())
          .filter(Boolean),
      )
      .refine(
        (list) => list.every((d) => /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(d)),
        "Holiday dates must be written as YYYY-MM-DD, one per line",
      ),
  })
  .refine((v) => v.endTime > v.startTime, {
    message: "The class has to end after it starts",
    path: ["endTime"],
  })
  .refine((v) => v.lastSessionDate >= v.firstSessionDate, {
    message: "The last date has to be on or after the first",
    path: ["lastSessionDate"],
  })
  .refine(
    (v) => v.gradeMin === null || v.gradeMax === null || v.gradeMax >= v.gradeMin,
    { message: "The highest grade has to be at or above the lowest", path: ["gradeMax"] },
  )
  .refine((v) => v.registrationMode !== "external" || v.externalRegistrationUrl !== null, {
    message: "A class the school enrols needs a link to send families to",
    path: ["externalRegistrationUrl"],
  })
  .refine((v) => v.registrationMode !== "keiki_coders" || v.priceCents !== null, {
    message: "A class we sell needs a price",
    path: ["priceCents"],
  })
  .refine(
    (v) => {
      // The generator walks weekly from the first date, so that date has to be
      // on the class weekday or the schedule and the calendar disagree in
      // silence. The database has a constraint; this is the readable refusal.
      const [y, m, d] = v.firstSessionDate.split("-").map(Number);
      return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === v.weekday;
    },
    {
      message: "The first date has to fall on the day of the week the class runs",
      path: ["firstSessionDate"],
    },
  );

export const OfferingIdForm = z.object({ offeringId: uuid });
export const SchoolIdForm = z.object({ schoolId: uuid });
export const ProgramIdForm = z.object({ programId: uuid });
export const TermIdForm = z.object({ termId: uuid });

export const ImportForm = z.object({
  source: z.enum(["live", "snapshot"]),
  dryRun: checkbox,
});
