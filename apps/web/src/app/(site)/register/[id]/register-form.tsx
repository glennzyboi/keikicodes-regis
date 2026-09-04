"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { HOLD_MINUTES } from "@keiki/core/holds";
import { CONSENT_SUMMARY, PARTICIPATION_POLICY } from "@keiki/core/policies";
import { DateField } from "@/components/date-field";
import { PhotoField } from "@/components/photo-field";
import { GRADE_LABELS, gradeRangeLabel } from "@/lib/grades";

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

const CARE_PROGRAMS = ["A+", "W+", "Another after school programme"];

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
  const [phone, setPhone] = useState(parentPhone ?? "");
  const [heardAboutUs, setHeardAboutUs] = useState("");
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [addGuardian, setAddGuardian] = useState(Boolean(existingGuardian));
  const [guardian, setGuardian] = useState(
    existingGuardian ?? { fullName: "", email: "", phone: "", relation: "" },
  );
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

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

  function useExisting(i: number, id: string) {
    const found = existingChildren.find((e) => e.id === id);
    setChildren((cs) =>
      cs.map((c, idx) =>
        idx === i ? (found ? { ...fromExisting(found), attendsSchoolConfirmed: c.attendsSchoolConfirmed } : blankChild()) : c,
      ),
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

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
          data.reason === "registered_elsewhere"
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
      // Stripe is another origin, so this one really is a location assignment.
      window.location.href = data.checkoutUrl;
    } catch {
      setError("Could not reach the server. Nothing was charged.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-5">
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
              required
              autoComplete="tel"
              placeholder="808-555-0142"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
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
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-display text-xl font-bold text-green-900">
            {children.length === 1 ? "Your child" : "Your children"}
          </h2>
          <button
            type="button"
            className="kc-btn kc-btn-quiet text-sm"
            onClick={() =>
              setChildren((c) => [
                ...c,
                unused.length > 0 ? fromExisting(unused[0]) : blankChild(),
              ])
            }
          >
            Add another child
          </button>
        </div>

        <div className="mt-5 space-y-5">
          {children.map((child, i) => {
            const pickable = existingChildren.filter(
              (e) => e.id === child.childId || !children.some((c) => c.childId === e.id),
            );
            return (
              <div key={i} className="rounded-[var(--radius-field)] bg-green-100 p-5">
                <div className="flex items-center justify-between">
                  <p className="font-display text-sm font-semibold text-green-900">
                    Child {i + 1}
                  </p>
                  {children.length > 1 && (
                    <button
                      type="button"
                      className="font-display text-sm font-semibold text-ink-soft underline"
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
                      onChange={(e) => useExisting(i, e.target.value)}
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
                      required
                      value={child.firstName}
                      onChange={(e) => setChild(i, { firstName: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="kc-label" htmlFor={`ln-${i}`}>
                      Last name
                    </label>
                    <input
                      id={`ln-${i}`}
                      className="kc-field"
                      required
                      value={child.lastName}
                      onChange={(e) => setChild(i, { lastName: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="kc-label" htmlFor={`grade-${i}`}>
                      Grade this year
                    </label>
                    <select
                      id={`grade-${i}`}
                      className="kc-field"
                      required
                      value={child.grade}
                      onChange={(e) => setChild(i, { grade: e.target.value })}
                    >
                      <option value="">Choose</option>
                      {GRADE_LABELS.map((label, g) => (
                        <option key={label} value={g}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <DateField
                    label="Date of birth"
                    required
                    yearsBack={19}
                    value={child.dateOfBirth}
                    onChange={(next) => setChild(i, { dateOfBirth: next })}
                  />

                  <div className="sm:col-span-2">
                    <PhotoField
                      parentId={parentId}
                      label="Photo of your child"
                      value={child.photoPath}
                      onChange={(path) => setChild(i, { photoPath: path })}
                    />
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
                          {child.firstName || "This child"} is in an after school care programme
                        </span>
                        <span className="mt-0.5 block text-xs text-ink-soft">
                          A+, W+ or similar. We hand children back to that programme rather
                          than to the gate.
                        </span>
                      </span>
                    </label>

                    {child.inAfterschoolCare && (
                      <div className="mt-3 sm:max-w-xs">
                        <label className="kc-label" htmlFor={`care-${i}`}>
                          Which programme?
                        </label>
                        <select
                          id={`care-${i}`}
                          className="kc-field"
                          value={child.afterschoolCareProgram}
                          onChange={(e) =>
                            setChild(i, { afterschoolCareProgram: e.target.value })
                          }
                        >
                          <option value="">Choose</option>
                          {CARE_PROGRAMS.map((p) => (
                            <option key={p} value={p}>
                              {p}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  <div className="sm:col-span-3">
                    <label className="kc-check">
                      <input
                        type="checkbox"
                        required
                        checked={child.attendsSchoolConfirmed}
                        onChange={(e) =>
                          setChild(i, { attendsSchoolConfirmed: e.target.checked })
                        }
                      />
                      <span>
                        I confirm {child.firstName || "this child"} is enrolled at and
                        attending <span className="font-medium">{classSchool}</span>.
                      </span>
                    </label>
                  </div>
                </div>
              </div>
            );
          })}
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
              <label className="kc-label" htmlFor="g-email">
                Their email (optional)
              </label>
              <input
                id="g-email"
                type="email"
                className="kc-field"
                value={guardian.email}
                onChange={(e) => setGuardian({ ...guardian, email: e.target.value })}
              />
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
              type="checkbox"
              required
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
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

          <label className="kc-check">
            <input
              type="checkbox"
              checked={marketingOptIn}
              onChange={(e) => setMarketingOptIn(e.target.checked)}
            />
            <span>
              Send me news about upcoming terms and programmes.
              <span className="mt-0.5 block text-xs text-ink-soft">
                Optional, and separate from the emails about your own registration, which
                we will always send.
              </span>
            </span>
          </label>
        </div>
      </section>

      {/* ------------------------------------------------------------- total */}
      <section className="kc-card p-7">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-ink-soft">
              {children.length} {children.length === 1 ? "child" : "children"} &times;{" "}
              {selectedClasses.length} {selectedClasses.length === 1 ? "class" : "classes"}
            </p>
            <p className="font-display text-3xl font-bold text-green-900">{money(total)}</p>
          </div>
          <button type="submit" className="kc-btn kc-btn-primary text-base" disabled={busy}>
            {busy ? "Holding your seats..." : "Continue to payment"}
          </button>
        </div>

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-[var(--radius-field)] bg-sun/25 px-4 py-3 text-sm font-medium text-ink"
          >
            {error}
          </p>
        )}

        <p className="mt-4 text-xs text-ink-soft">
          Your seats are held for {HOLD_MINUTES} minutes while you pay. Registering for{" "}
          <span className="font-semibold">{classTitle}</span>
          {extraClasses.length > 0 && ` and ${extraClasses.length} more`}.
        </p>
      </section>
    </form>
  );
}
