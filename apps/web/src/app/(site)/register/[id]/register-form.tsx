"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { HOLD_MINUTES } from "@keiki/core/holds";
import { CONSENT_SUMMARY, PARTICIPATION_POLICY } from "@keiki/core/policies";
import { DateField } from "@/components/date-field";
import { PhotoField } from "@/components/photo-field";
import { GRADE_LABELS, gradeRangeLabel } from "@/lib/grades";
import { InlineCheckout } from "./embedded-checkout";

/**
 * The registration form.
 *
 * It collects everything their Fillout form collects, field for field, because
 * anything dropped here is something their office loses on the first day of
 * term: grade, a head shot, whether the child is in A+ or W+ care, the
 * attestation that the child actually attends this campus, a second guardian,
 * how they heard about us, the marketing choice, and a dated consent.
 *
 * What it does differently is all one idea: stop asking a parent for things we
 * already know.
 *
 *   - Two children go on one order and one payment. Their form is one student
 *     per submission, so a family with two keiki fills it in twice, retypes
 *     both parents twice, and pays twice.
 *   - A returning family picks a child off their account instead of retyping a
 *     name, a birthday, a grade and a photograph every term.
 *   - The guardian and the consent are remembered, so the second registration
 *     is: pick the child, tick the box, pay.
 *   - Grades are checked against the class before payment rather than after
 *     somebody reads the roster.
 */

type Other = {
  id: string;
  title: string;
  school: string;
  price_cents: number;
  left: number;
  weekday: number;
  start_time: string;
  end_time: string;
  grade_min: number | null;
  grade_max: number | null;
  clashes: boolean;
};

type ExistingChild = {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  grade: number | null;
  notes: string;
  photoPath: string | null;
  inAfterschoolCare: boolean;
  afterschoolCareProgram: string;
};

type Child = {
  childId: string | null;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  grade: string;
  notes: string;
  photoPath: string | null;
  inAfterschoolCare: boolean;
  afterschoolCareProgram: string;
  attendsSchoolConfirmed: boolean;
};

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

const blankChild = (): Child => ({
  childId: null,
  firstName: "",
  lastName: "",
  dateOfBirth: "",
  grade: "",
  notes: "",
  photoPath: null,
  inAfterschoolCare: false,
  afterschoolCareProgram: "",
  attendsSchoolConfirmed: false,
});

const fromExisting = (e: ExistingChild): Child => ({
  childId: e.id,
  firstName: e.firstName,
  lastName: e.lastName,
  dateOfBirth: e.dateOfBirth,
  grade: e.grade === null ? "" : String(e.grade),
  notes: e.notes,
  photoPath: e.photoPath,
  inAfterschoolCare: e.inAfterschoolCare,
  afterschoolCareProgram: e.afterschoolCareProgram,
  attendsSchoolConfirmed: false,
});

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const HEARD_OPTIONS = [
  "My child's school",
  "A friend or another parent",
  "Instagram",
  "Google or a web search",
  "We have registered before",
  "Somewhere else",
];

const CARE_PROGRAMS = ["A+", "W+", "Another after school program"];

function clock(t: string) {
  const [h, m] = t.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour}${suffix}` : `${hour}:${String(m).padStart(2, "0")}${suffix}`;
}

export default function RegisterForm({
  parentId,
  parentName,
  parentEmail,
  parentPhone,
  classId,
  classTitle,
  classSchool,
  priceCents,
  gradeMin,
  gradeMax,
  others,
  existingChildren,
  existingGuardian,
  alreadyConsented,
  policyVersion,
}: {
  parentId: string;
  parentName: string;
  parentEmail: string;
  parentPhone: string | null;
  classId: string;
  classTitle: string;
  classSchool: string;
  priceCents: number;
  gradeMin: number | null;
  gradeMax: number | null;
  others: Other[];
  existingChildren: ExistingChild[];
  existingGuardian: { fullName: string; email: string; phone: string; relation: string } | null;
  alreadyConsented: boolean;
  policyVersion: string;
}) {
  const [children, setChildren] = useState<Child[]>([
    existingChildren.length === 1 ? fromExisting(existingChildren[0]) : blankChild(),
  ]);
  const [extraClasses, setExtraClasses] = useState<string[]>([]);
  // Deliberately not seeded from the account. A pre-filled field is one nobody
  // checks, and a stale mobile number is worse than an empty box because the
  // office believes it. The saved number is offered as one tap instead, below.
  const [phone, setPhone] = useState("");
  const [heardAboutUs, setHeardAboutUs] = useState("");
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [addGuardian, setAddGuardian] = useState(Boolean(existingGuardian));
  const [guardian, setGuardian] = useState(
    existingGuardian ?? { fullName: "", email: "", phone: "", relation: "" },
  );
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * The Stripe session, once the server has created one.
   *
   * Its presence is what swaps the form for the card fields. Keeping it in
   * state rather than navigating is the whole point of the change: the seat is
   * held, the order exists, and going "back to the form" costs nothing, because
   * the same idempotency key returns the same session rather than making a
   * second one.
   */
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  // The real seat_holds.expires_at for this order, so the checkout counts down
  // the hold that exists rather than one it assumes. A resubmitted registration
  // reuses its original hold and has less time left than a fresh one.
  const [holdExpiresAt, setHoldExpiresAt] = useState<string | null>(null);
  /**
   * Field level problems, keyed by the input's id.
   *
   * Empty until somebody submits, deliberately. Validating as they type means
   * telling a parent their name is too short while they are halfway through
   * typing it, which is the single most annoying thing a form can do. After the
   * first failed submit each field clears its own error the moment it is
   * fixed, because at that point the message has been seen and leaving it up is
   * the second most annoying thing.
   */
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [showSummary, setShowSummary] = useState(false);
  const router = useRouter();

  /** Clear one field's complaint, used by every onChange below. */
  function fixed(id: string) {
    setProblems((p) => {
      if (!p[id]) return p;
      const next = { ...p };
      delete next[id];
      return next;
    });
  }

  /**
   * Minted once, when the form mounts. It travels with the submission, so a
   * double click, a slow network retry, or the parent hitting back and
   * submitting again all arrive carrying the same key and resolve to one order.
   */
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  const selectedClasses = [classId, ...extraClasses];
  const perChild =
    priceCents +
    extraClasses.reduce((s, id) => s + (others.find((o) => o.id === id)?.price_cents ?? 0), 0);
  const total = perChild * children.length;

  const unused = existingChildren.filter(
    (e) => !children.some((c) => c.childId === e.id),
  );

  const thisClassRange = gradeRangeLabel(gradeMin, gradeMax);

  /** Grades that do not fit this class, named so the parent can act on it. */
  const gradeProblems = children
    .map((c, i) => {
      if (c.grade === "") return null;
      const g = Number(c.grade);
      if (gradeMin !== null && g < gradeMin) return { i, c };
      if (gradeMax !== null && g > gradeMax) return { i, c };
      return null;
    })
    .filter((x): x is { i: number; c: Child } => x !== null);

  function setChild(i: number, patch: Partial<Child>) {
    setChildren((cs) => cs.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }

  /** Swap one card over to a child already on the account. Named without a
   `use` prefix on purpose: it is a plain handler, and calling it from an
   onChange tripped the rules-of-hooks lint when it was `useExisting`. */
  function pickExisting(i: number, id: string) {
    const found = existingChildren.find((e) => e.id === id);
    setChildren((cs) =>
      cs.map((c, idx) =>
        idx === i ? (found ? { ...fromExisting(found), attendsSchoolConfirmed: c.attendsSchoolConfirmed } : blankChild()) : c,
      ),
    );
  }

  /**
   * Everything wrong with the form, as a map of field id to message.
   *
   * This exists because `required` on an input is not error handling. The
   * browser shows one bubble, on the first bad field, in its own wording, and
   * it disappears the moment you look away. On a form this long, with a child
   * repeated two or three times, a parent needs to see everything that is
   * wrong at once and be able to jump to it.
   *
   * The server checks all of this again and is the authority. This is here so
   * the answer arrives instantly and points at the field, not so the server can
   * trust it.
   */
  function validate(): Record<string, string> {
    const found: Record<string, string> = {};
    const today = new Date();

    children.forEach((child, i) => {
      if (child.firstName.trim().length < 1) found[`fn-${i}`] = "Please give a first name.";
      if (child.lastName.trim().length < 1) found[`ln-${i}`] = "Please give a last name.";
      if (child.grade === "") found[`grade-${i}`] = "Please choose the grade they are in.";

      if (!child.dateOfBirth) {
        found[`dob-${i}`] = "Please give a date of birth.";
      } else {
        const [y, m, d] = child.dateOfBirth.split("-").map(Number);
        const dob = new Date(Date.UTC(y, m - 1, d));
        const years = (today.getTime() - dob.getTime()) / (365.25 * 24 * 3600 * 1000);
        // Not a validation of who may attend, which is what the grade is for.
        // This catches the two real mistakes: today's date, and a typed year.
        if (dob > today) found[`dob-${i}`] = "That date is in the future.";
        else if (years > 19) found[`dob-${i}`] = "Please check the year on that date.";
      }

      if (!child.photoPath) {
        found[`photo-${i}`] =
          "Please add a photo. The instructor uses it to know who is in the room.";
      }

      if (!child.attendsSchoolConfirmed) {
        found[`attends-${i}`] =
          "Please confirm your child attends this school, as the class is held there.";
      }

      if (child.inAfterschoolCare && !child.afterschoolCareProgram.trim()) {
        found[`care-${i}`] = "Which program? We need it to know where to hand them back.";
      }
    });

    if (addGuardian && guardian.fullName.trim()) {
      // Their own form requires the second guardian's email and phone while
      // leaving the name optional, which forces a family to supply contact
      // details for somebody they were not required to name. Ours asks for the
      // name first and then completes the picture.
      if (!guardian.email.trim() && !guardian.phone.trim()) {
        found["guardian-email"] =
          "Give an email or a phone number for them, so we can reach one of you.";
      } else if (guardian.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guardian.email.trim())) {
        found["guardian-email"] = "That does not look like an email address.";
      }
    }

    // The markup said required, but the form is noValidate and nothing checked
    // it, so this was reachable: a paid registration with no phone number and a
    // class starting on Tuesday.
    const digits = phone.replace(/[^0-9]/g, "");
    if (digits.length === 0) {
      found["parent-phone"] = "Please give a phone number we can reach you on.";
    } else if (digits.length < 7) {
      found["parent-phone"] = "That does not look like enough digits.";
    }

    if (!agreed) found["consent"] = "Please agree to the policies before paying.";

    return found;
  }

  /** The label a summary link shows, so it reads as a sentence not an id. */
  function fieldLabel(id: string) {
    const [kind, index] = id.split("-");
    const child = children[Number(index)];
    const who =
      child && child.firstName.trim()
        ? child.firstName.trim()
        : children.length > 1
          ? `child ${Number(index) + 1}`
          : "your child";
    switch (kind) {
      case "fn":
        return `First name for ${who}`;
      case "ln":
        return `Last name for ${who}`;
      case "grade":
        return `Grade for ${who}`;
      case "dob":
        return `Date of birth for ${who}`;
      case "attends":
        return `School confirmation for ${who}`;
      case "care":
        return `After school care for ${who}`;
      case "photo":
        return `Photo of ${who}`;
      case "guardian":
        return "Second guardian's contact details";
      case "consent":
        return "Agreeing to the policies";
      case "parent":
        return "Your phone number";
      default:
        return "A field above";
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const found = validate();
    setProblems(found);
    if (Object.keys(found).length > 0) {
      setShowSummary(true);
      // The summary first, because it says how many things are wrong; then the
      // field, so the cursor is where the work is.
      requestAnimationFrame(() => {
        document.getElementById("kc-error-summary")?.scrollIntoView({
          block: "center",
          behavior: "smooth",
        });
        document.getElementById(Object.keys(found)[0])?.focus({ preventScroll: true });
      });
      return;
    }

    setShowSummary(false);
    setBusy(true);

    // Every child is registered into every selected class, which is the shape
    // their brief describes: several children, several classes, one payment.
    const registrations = children.flatMap((child) =>
      selectedClasses.map((classOfferingId) => ({
        classOfferingId,
        attendsSchoolConfirmed: child.attendsSchoolConfirmed,
        child: {
          childId: child.childId ?? undefined,
          firstName: child.firstName,
          lastName: child.lastName,
          dateOfBirth: child.dateOfBirth,
          grade: Number(child.grade),
          notes: child.notes || null,
          photoPath: child.photoPath,
          inAfterschoolCare: child.inAfterschoolCare,
          afterschoolCareProgram: child.inAfterschoolCare
            ? child.afterschoolCareProgram || null
            : null,
        },
      })),
    );

    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idempotencyKey,
          registrations,
          agreedToPolicies: true,
          policyVersion,
          marketingOptIn,
          heardAboutUs: heardAboutUs || null,
          parentPhone: phone || null,
          guardian: addGuardian && guardian.fullName ? guardian : null,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        if (data.reason === "class_full") {
          const names = (data.fullClasses ?? []).map((c: { title: string }) => c.title).join(", ");
          setError(`Sorry, ${names} filled up while you were registering. Nothing was charged.`);
        } else if (
          data.reason === "already_enrolled" ||
          data.reason === "schedule_conflict" ||
          data.reason === "grade_not_eligible" ||
          data.reason === "registered_elsewhere" ||
          data.reason === "photo_not_yours"
        ) {
          setError(data.detail);
        } else if (data.reason === "class_not_available") {
          setError("That class is not open for registration.");
        } else {
          setError("Something went wrong. Nothing was charged, please try again.");
        }
        setBusy(false);
        return;
      }

      if (data.alreadyPaid) {
        router.push(`/confirming?order=${data.orderId}`);
        return;
      }

      if (!data.clientSecret) {
        setError("Could not start the payment. Nothing was charged, please try again.");
        setBusy(false);
        return;
      }

      // Checkout opens in this page rather than on Stripe's domain. Nothing
      // navigates, so `busy` has to be released by hand: it used to rely on the
      // page being torn down by the redirect, which no longer happens.
      setClientSecret(data.clientSecret);
      setHoldExpiresAt(data.holdExpiresAt ?? null);
      setBusy(false);
    } catch {
      setError("Could not reach the server. Nothing was charged.");
      setBusy(false);
    }
  }

  const problemList = Object.entries(problems);

  /**
   * The shape every online shop uses for a checkout, and for the same reasons.
   *
   * The form runs down the left and a summary stays pinned on the right, so the
   * price, the seats and what is actually being bought never scroll away. When
   * payment starts, the card fields take the left column and that summary is
   * still there: nothing navigates, nothing is replaced by a screen the parent
   * has not seen before, and the thing they are paying for stays on screen
   * while they pay for it.
   *
   * The form fields themselves do go away at that point, deliberately. Leaving
   * fifteen live inputs beside a payment form invites somebody to change a
   * child's grade after the amount has been fixed, and then the thing they are
   * paying for is not the thing they agreed to.
   */
  const side = (
    <OrderSummary
      classTitle={classTitle}
      classSchool={classSchool}
      childCount={children.length}
      classCount={selectedClasses.length}
      perChild={perChild}
      total={total}
      paying={Boolean(clientSecret)}
      busy={busy}
      error={error}
      onBack={() => {
        setClientSecret(null);
        setHoldExpiresAt(null);
        setError(null);
      }}
    />
  );

  if (clientSecret) {
    return (
      <div className="kc-reg">
        <div className="kc-reg-main">
          <InlineCheckout clientSecret={clientSecret} holdExpiresAt={holdExpiresAt} />
        </div>
        <aside className="kc-reg-side">{side}</aside>
      </div>
    );
  }

  return (
    <div className="kc-reg">
      <div className="kc-reg-main">
        {/*
          The submit button lives in the sticky panel, outside this form.
          `form="kc-register"` is the HTML attribute for exactly that, so it is
          a real submit rather than a click handler pretending to be one: the
          Enter key still works, and so does everything a browser does for free.
        */}
        <form id="kc-register" onSubmit={submit} className="space-y-5" noValidate>
      {/*
        The summary, at the top, listing everything wrong with links to each
        field. On a form with fifteen inputs and a child repeated twice, one
        message at the bottom saying "please check the form" is the same as no
        message: the parent has to hunt. This is the pattern every accessibility
        guideline asks for and almost no registration form implements.
      */}
      {showSummary && problemList.length > 0 && (
        <div
          id="kc-error-summary"
          role="alert"
          tabIndex={-1}
          className="kc-error-summary"
        >
          <p className="font-display font-bold">
            {problemList.length === 1
              ? "One thing needs your attention"
              : `${problemList.length} things need your attention`}
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {problemList.map(([id, message]) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    const el = document.getElementById(id);
                    el?.scrollIntoView({ block: "center", behavior: "smooth" });
                    el?.focus({ preventScroll: true });
                  }}
                >
                  {fieldLabel(id)}
                </a>
                : {message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ------------------------------------------------------------ parent */}
      <section className="kc-card p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-bold text-green-900">Registering as</h2>
            <p className="mt-1.5 font-medium">{parentName}</p>
            <p className="text-sm text-ink-soft">{parentEmail}</p>
          </div>
          <span className="kc-chip kc-chip-accent">Signed in</span>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="kc-label" htmlFor="parent-phone">
              Your phone number
            </label>
            <input
              id="parent-phone"
              className="kc-field"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="808-555-0142"
              aria-invalid={Boolean(problems["parent-phone"])}
              aria-describedby={problems["parent-phone"] ? "parent-phone-err" : undefined}
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                fixed("parent-phone");
              }}
            />
            <FieldError id="parent-phone" message={problems["parent-phone"]} />
            {parentPhone && phone !== parentPhone && (
              <button
                type="button"
                className="mt-1.5 text-xs font-semibold text-green-700 underline underline-offset-2"
                onClick={() => {
                  setPhone(parentPhone);
                  fixed("parent-phone");
                }}
              >
                Use {parentPhone}, the number on your account
              </button>
            )}
            <p className="mt-1.5 text-xs text-ink-soft">
              Only used if we need to reach you about a class on the day.
            </p>
          </div>
          <div>
            <label className="kc-label" htmlFor="heard">
              How did you hear about us?
            </label>
            <select
              id="heard"
              className="kc-field"
              value={heardAboutUs}
              onChange={(e) => setHeardAboutUs(e.target.value)}
            >
              <option value="">Prefer not to say</option>
              {HEARD_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
        </div>

        <p className="mt-4 text-sm text-ink-soft">
          Your keiki are saved to this account, so next term you can register them again
          without typing anything twice.
        </p>
      </section>

      {/* ---------------------------------------------------------- children */}
      <section className="kc-card p-7">
        <div>
          <h2 className="font-display text-xl font-bold text-green-900">
            {children.length === 1 ? "Your child" : "Your children"}
          </h2>
          <p className="mt-1 text-sm text-ink-soft">
            {children.length === 1
              ? "Registering more than one? Add them below and they go on the same payment."
              : `${children.length} children on one order and one payment.`}
          </p>
        </div>

        <div className="mt-5 space-y-5">
          {children.map((child, i) => {
            const pickable = existingChildren.filter(
              (e) => e.id === child.childId || !children.some((c) => c.childId === e.id),
            );
            return (
              <div key={i} className="kc-child-card">
                <div className="kc-child-head">
                  <span className="kc-child-badge" aria-hidden>
                    {i + 1}
                  </span>
                  <p className="kc-child-title">
                    {child.firstName.trim()
                      ? `${child.firstName.trim()}${child.lastName.trim() ? ` ${child.lastName.trim()}` : ""}`
                      : children.length === 1
                        ? "Your child"
                        : `Child ${i + 1}`}
                  </p>
                  {children.length > 1 && (
                    <button
                      type="button"
                      className="kc-child-remove"
                      onClick={() => setChildren((cs) => cs.filter((_, idx) => idx !== i))}
                    >
                      Remove
                    </button>
                  )}
                </div>

                {pickable.length > 0 && (
                  <div className="mt-3">
                    <label className="kc-label" htmlFor={`who-${i}`}>
                      Which child?
                    </label>
                    <select
                      id={`who-${i}`}
                      className="kc-field"
                      value={child.childId ?? ""}
                      onChange={(e) => pickExisting(i, e.target.value)}
                    >
                      <option value="">Someone new</option>
                      {pickable.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.firstName} {e.lastName}
                        </option>
                      ))}
                    </select>
                    {child.childId && (
                      <p className="mt-1.5 text-xs text-ink-soft">
                        Already on your account. Change anything below that has moved on.
                      </p>
                    )}
                  </div>
                )}

                <div className="mt-3 grid gap-4 sm:grid-cols-3">
                  <div>
                    <label className="kc-label" htmlFor={`fn-${i}`}>
                      First name
                    </label>
                    <input
                      id={`fn-${i}`}
                      className="kc-field"
                      autoComplete="off"
                      aria-invalid={Boolean(problems[`fn-${i}`])}
                      aria-describedby={problems[`fn-${i}`] ? `fn-${i}-err` : undefined}
                      value={child.firstName}
                      onChange={(e) => {
                        setChild(i, { firstName: e.target.value });
                        fixed(`fn-${i}`);
                      }}
                    />
                    <FieldError id={`fn-${i}`} message={problems[`fn-${i}`]} />
                  </div>
                  <div>
                    <label className="kc-label" htmlFor={`ln-${i}`}>
                      Last name
                    </label>
                    <input
                      id={`ln-${i}`}
                      className="kc-field"
                      autoComplete="off"
                      aria-invalid={Boolean(problems[`ln-${i}`])}
                      aria-describedby={problems[`ln-${i}`] ? `ln-${i}-err` : undefined}
                      value={child.lastName}
                      onChange={(e) => {
                        setChild(i, { lastName: e.target.value });
                        fixed(`ln-${i}`);
                      }}
                    />
                    <FieldError id={`ln-${i}`} message={problems[`ln-${i}`]} />
                  </div>
                  <div>
                    <label className="kc-label" htmlFor={`grade-${i}`}>
                      Grade this year
                    </label>
                    <select
                      id={`grade-${i}`}
                      className="kc-field"
                      aria-invalid={Boolean(problems[`grade-${i}`])}
                      aria-describedby={problems[`grade-${i}`] ? `grade-${i}-err` : undefined}
                      value={child.grade}
                      onChange={(e) => {
                        setChild(i, { grade: e.target.value });
                        fixed(`grade-${i}`);
                      }}
                    >
                      <option value="">Choose</option>
                      {GRADE_LABELS.map((label, g) => (
                        <option key={label} value={g}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <FieldError id={`grade-${i}`} message={problems[`grade-${i}`]} />
                  </div>

                  <div>
                    <DateField
                      label="Date of birth"
                      required
                      yearsBack={19}
                      value={child.dateOfBirth}
                      onChange={(next) => {
                        setChild(i, { dateOfBirth: next });
                        fixed(`dob-${i}`);
                      }}
                    />
                    {/* Focus target for the error summary. A visually hidden
                        input rather than the zero-size span this used to be: a
                        span with tabIndex={-1} can be focused but is not
                        announced, so the summary link went nowhere audible. */}
                    <input
                      id={`dob-${i}`}
                      className="sr-only"
                      tabIndex={-1}
                      readOnly
                      aria-label={`Date of birth for child ${i + 1}`}
                      value={child.dateOfBirth}
                      onFocus={() => document.getElementById(`dob-${i}-day`)?.focus()}
                    />
                    <FieldError id={`dob-${i}`} message={problems[`dob-${i}`]} />
                  </div>

                  <div className="sm:col-span-2">
                    <PhotoField
                      parentId={parentId}
                      label="Photo of your child"
                      // Required, because their own Fillout form requires a head
                      // shot and the instructor uses it to know who is in the
                      // room on day one. It was optional here, which meant a
                      // failed upload was invisible: the parent paid, and the
                      // roster had a blank where a face should be.
                      required
                      value={child.photoPath}
                      onChange={(path) => setChild(i, { photoPath: path })}
                    />
                    <FieldError id={`photo-${i}`} message={problems[`photo-${i}`]} />
                  </div>

                  <div className="sm:col-span-3">
                    <label className="kc-label" htmlFor={`notes-${i}`}>
                      Allergies or anything we should know (optional)
                    </label>
                    <input
                      id={`notes-${i}`}
                      className="kc-field"
                      value={child.notes}
                      onChange={(e) => setChild(i, { notes: e.target.value })}
                    />
                  </div>

                  <div className="sm:col-span-3">
                    <label className="kc-check">
                      <input
                        type="checkbox"
                        checked={child.inAfterschoolCare}
                        onChange={(e) => setChild(i, { inAfterschoolCare: e.target.checked })}
                      />
                      <span>
                        <span className="font-medium">
                          {child.firstName || "This child"} is in an after school care program
                        </span>
                        <span className="mt-0.5 block text-xs text-ink-soft">
                          A+, W+ or similar. We hand children back to that program rather
                          than to the gate.
                        </span>
                      </span>
                    </label>

                    {child.inAfterschoolCare && (
                      <div className="mt-3 sm:max-w-xs">
                        <label className="kc-label" htmlFor={`care-${i}`}>
                          Which program?
                        </label>
                        <select
                          id={`care-${i}`}
                          className="kc-field"
                          aria-invalid={Boolean(problems[`care-${i}`])}
                          aria-describedby={problems[`care-${i}`] ? `care-${i}-err` : undefined}
                          value={child.afterschoolCareProgram}
                          onChange={(e) => {
                            setChild(i, { afterschoolCareProgram: e.target.value });
                            fixed(`care-${i}`);
                          }}
                        >
                          <option value="">Choose</option>
                          {CARE_PROGRAMS.map((p) => (
                            <option key={p} value={p}>
                              {p}
                            </option>
                          ))}
                        </select>
                        <FieldError id={`care-${i}`} message={problems[`care-${i}`]} />
                      </div>
                    )}
                  </div>

                  <div className="sm:col-span-3">
                    <label className="kc-check">
                      <input
                        id={`attends-${i}`}
                        type="checkbox"
                        aria-invalid={Boolean(problems[`attends-${i}`])}
                        aria-describedby={
                          problems[`attends-${i}`] ? `attends-${i}-err` : undefined
                        }
                        checked={child.attendsSchoolConfirmed}
                        onChange={(e) => {
                          setChild(i, { attendsSchoolConfirmed: e.target.checked });
                          fixed(`attends-${i}`);
                        }}
                      />
                      <span>
                        I confirm {child.firstName || "this child"} is enrolled at and
                        attending <span className="font-medium">{classSchool}</span>.
                      </span>
                    </label>
                    <FieldError id={`attends-${i}`} message={problems[`attends-${i}`]} />
                  </div>
                </div>
              </div>
            );
          })}

          {/* Under the list, where the eye is after finishing a child, rather
              than a quiet button back up in the heading. This is the single
              most valuable thing on the form and it was the easiest to miss:
              their own form is one student per submission, so a family with two
              keiki fills it in twice and pays twice. */}
          <button
            type="button"
            className="kc-add-child"
            onClick={() =>
              setChildren((c) => [
                ...c,
                unused.length > 0 ? fromExisting(unused[0]) : blankChild(),
              ])
            }
          >
            <span className="kc-add-child-plus" aria-hidden>
              +
            </span>
            <span>
              <span className="kc-add-child-title">Add another child</span>
              <span className="kc-add-child-note">
                {unused.length > 0
                  ? `${unused[0].firstName} is already on your account`
                  : "Same order, same payment, and nothing typed twice"}
              </span>
            </span>
          </button>
        </div>

        {gradeProblems.length > 0 && thisClassRange && (
          <p role="alert" className="kc-alert mt-5">
            {gradeProblems
              .map(
                (p) =>
                  `${p.c.firstName || `Child ${p.i + 1}`} is in ${GRADE_LABELS[Number(p.c.grade)]}`,
              )
              .join(", ")}
            , and {classTitle} is for {thisClassRange.toLowerCase()}. Have a look at the
            other classes at {classSchool}, which are sorted by grade.
          </p>
        )}
      </section>

      {/* ------------------------------------------------------ extra classes */}
      {others.length > 0 && (
        <section className="kc-card p-7">
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
              <span>
                <span className="font-display text-xl font-bold text-green-900">
                  Add another class
                </span>
                <span className="kc-chip ml-2">Optional</span>
                <span className="mt-1 block text-sm text-ink-soft">
                  Most families register for one. Anything you add applies to every child
                  above, on the same payment.
                </span>
              </span>
              <span
                aria-hidden
                className="grid h-8 w-8 flex-none place-items-center rounded-full border border-hairline transition-transform group-open:rotate-180"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </span>
            </summary>

            <div className="mt-4 space-y-2">
              {others.map((o) => {
                const chosen = extraClasses.includes(o.id);
                const range = gradeRangeLabel(o.grade_min, o.grade_max);
                return (
                  <label
                    key={o.id}
                    className={`flex items-center gap-3 rounded-[var(--radius-field)] border-2 p-3 transition-colors ${
                      o.clashes
                        ? "cursor-not-allowed border-hairline opacity-55"
                        : "cursor-pointer border-hairline hover:border-green-200"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="h-5 w-5 accent-green-700"
                      checked={chosen}
                      disabled={o.clashes}
                      onChange={(e) =>
                        setExtraClasses((v) =>
                          e.target.checked ? [...v, o.id] : v.filter((x) => x !== o.id),
                        )
                      }
                    />
                    <span className="flex-1">
                      <span className="font-display font-semibold">{o.title}</span>
                      <span className="mt-0.5 block text-xs text-ink-soft">
                        {DAY_SHORT[o.weekday]} {clock(o.start_time)} to {clock(o.end_time)}
                        {range ? ` · ${range}` : ""}
                        {o.clashes ? " · clashes with this class" : ""}
                      </span>
                    </span>
                    <span className="font-display font-semibold text-green-900">
                      {money(o.price_cents)}
                    </span>
                  </label>
                );
              })}
            </div>
          </details>
        </section>
      )}

      {/* ---------------------------------------------------------- guardian */}
      <section className="kc-card p-7">
        <label className="kc-check">
          <input
            type="checkbox"
            checked={addGuardian}
            onChange={(e) => setAddGuardian(e.target.checked)}
          />
          <span>
            <span className="font-display text-lg font-bold text-green-900">
              Add a second parent or guardian
            </span>
            <span className="mt-0.5 block text-sm text-ink-soft">
              Optional. Someone else we can reach, and who may collect your child.
            </span>
          </span>
        </label>

        {addGuardian && (
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="kc-label" htmlFor="g-name">
                Their name
              </label>
              <input
                id="g-name"
                className="kc-field"
                value={guardian.fullName}
                onChange={(e) => setGuardian({ ...guardian, fullName: e.target.value })}
              />
            </div>
            <div>
              <label className="kc-label" htmlFor="g-rel">
                Relationship (optional)
              </label>
              <input
                id="g-rel"
                className="kc-field"
                placeholder="Parent, grandparent, aunty"
                value={guardian.relation}
                onChange={(e) => setGuardian({ ...guardian, relation: e.target.value })}
              />
            </div>
            <div>
              <label className="kc-label" htmlFor="guardian-email">
                Their email (optional)
              </label>
              <input
                id="guardian-email"
                type="email"
                className="kc-field"
                aria-invalid={Boolean(problems["guardian-email"])}
                aria-describedby={problems["guardian-email"] ? "guardian-email-err" : undefined}
                value={guardian.email}
                onChange={(e) => {
                  setGuardian({ ...guardian, email: e.target.value });
                  fixed("guardian-email");
                }}
              />
              <FieldError id="guardian-email" message={problems["guardian-email"]} />
            </div>
            <div>
              <label className="kc-label" htmlFor="g-phone">
                Their phone (optional)
              </label>
              <input
                id="g-phone"
                type="tel"
                className="kc-field"
                value={guardian.phone}
                onChange={(e) => setGuardian({ ...guardian, phone: e.target.value })}
              />
            </div>
          </div>
        )}
      </section>

      {/* ----------------------------------------------------------- consent */}
      <section className="kc-card p-7">
        <h2 className="font-display text-xl font-bold text-green-900">Before you pay</h2>

        <details className="group mt-4 rounded-[var(--radius-field)] border border-hairline">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
            <span className="font-display text-sm font-semibold text-green-900">
              Read the participation, safety and cancellation policies
            </span>
            <span
              aria-hidden
              className="grid h-7 w-7 flex-none place-items-center rounded-full border border-hairline transition-transform group-open:rotate-180"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </span>
          </summary>
          <div className="space-y-4 border-t border-hairline px-4 py-4">
            {PARTICIPATION_POLICY.map((s) => (
              <div key={s.heading}>
                <h3 className="font-display text-sm font-semibold text-green-900">
                  {s.heading}
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-ink-soft">{s.body}</p>
              </div>
            ))}
            <p className="text-xs text-ink-soft">Version {policyVersion}.</p>
          </div>
        </details>

        <div className="mt-4 space-y-3">
          <label className="kc-check">
            <input
              id="consent"
              type="checkbox"
              aria-invalid={Boolean(problems.consent)}
              aria-describedby={problems.consent ? "consent-err" : undefined}
              checked={agreed}
              onChange={(e) => {
                setAgreed(e.target.checked);
                fixed("consent");
              }}
            />
            <span>
              {CONSENT_SUMMARY}
              {alreadyConsented && (
                <span className="mt-0.5 block text-xs text-ink-soft">
                  You agreed to this version already. Confirming again keeps the record
                  tied to this registration.
                </span>
              )}
            </span>
          </label>
          <FieldError id="consent" message={problems.consent} />

          <label className="kc-check">
            <input
              type="checkbox"
              checked={marketingOptIn}
              onChange={(e) => setMarketingOptIn(e.target.checked)}
            />
            <span>
              Send me news about upcoming terms and programs.
              <span className="mt-0.5 block text-xs text-ink-soft">
                Optional, and separate from the emails about your own registration, which
                we will always send.
              </span>
            </span>
          </label>
        </div>
      </section>

        </form>
      </div>
      <aside className="kc-reg-side">{side}</aside>
    </div>
  );
}

/**
 * The order summary, pinned.
 *
 * Everything an online shop puts in this panel and for the same reason: what is
 * being bought, how many, what it costs, and the one button. It stays on screen
 * through the whole form and through payment, so the price never scrolls away
 * and nobody has to remember what they picked four sections ago.
 *
 * During payment it deliberately thins out. Stripe's own iframe carries an
 * itemised summary of its own, and two of them side by side is not reassurance,
 * it is a reason to wonder which one is right.
 */
function OrderSummary({
  classTitle,
  classSchool,
  childCount,
  classCount,
  perChild,
  total,
  paying,
  busy,
  error,
  onBack,
}: {
  classTitle: string;
  classSchool: string;
  childCount: number;
  classCount: number;
  perChild: number;
  total: number;
  paying: boolean;
  busy: boolean;
  error: string | null;
  onBack: () => void;
}) {
  return (
    <div className="kc-summary">
      <p className="kc-summary-eyebrow">{paying ? "You are paying for" : "Your registration"}</p>
      <p className="kc-summary-class">{classTitle}</p>
      <p className="kc-summary-school">{classSchool}</p>

      <dl className="kc-summary-lines">
        <div>
          <dt>
            {childCount} {childCount === 1 ? "keiki" : "keiki"} &times; {classCount}{" "}
            {classCount === 1 ? "class" : "classes"}
          </dt>
          <dd>{money(perChild)} each</dd>
        </div>
        <div className="kc-summary-total">
          <dt>Total</dt>
          <dd>{money(total)}</dd>
        </div>
      </dl>

      {paying ? (
        <>
          <button type="button" className="kc-btn kc-btn-quiet w-full" onClick={onBack}>
            Back to the form
          </button>
          <p className="kc-summary-note">
            Card details go to Stripe, never to us. Your seats stay held while you pay.
          </p>
        </>
      ) : (
        <>
          {/*
            Outside the form, attached to it by id. A real submit, so Enter in
            any field still works and the browser does the rest for free.
          */}
          <button
            type="submit"
            form="kc-register"
            className="kc-btn kc-btn-primary w-full text-base"
            disabled={busy}
          >
            {busy ? "Holding your seats…" : "Continue to payment"}
          </button>

          {error && (
            <p
              role="alert"
              className="mt-3 rounded-[var(--radius-field)] bg-sun/25 px-4 py-3 text-sm font-medium text-ink"
            >
              {error}
            </p>
          )}

          <p className="kc-summary-note">
            Seats are held for {HOLD_MINUTES} minutes while you pay. Nothing is charged until
            you finish.
          </p>
        </>
      )}
    </div>
  );
}

/**
 * One field's complaint.
 *
 * The id is derived from the field's own id so `aria-describedby` can point at
 * it, which is what makes a screen reader read the message when focus lands on
 * the input rather than leaving it as text somebody has to go looking for.
 *
 * Not `role="alert"`. The summary at the top is the alert, and eight live
 * regions announcing at once is worse than none.
 */
function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={`${id}-err`} className="kc-field-error mt-1.5">
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden
        className="mt-0.5 flex-none"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v5M12 16.5v.01" />
      </svg>
      {message}
    </p>
  );
}
