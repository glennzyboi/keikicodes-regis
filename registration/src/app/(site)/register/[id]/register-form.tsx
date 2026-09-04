"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { HOLD_MINUTES } from "@/lib/holds";
import { DateField } from "@/components/date-field";

type Other = {
  id: string;
  title: string;
  school: string;
  price_cents: number;
  left: number;
  weekday: number;
  start_time: string;
  end_time: string;
  clashes: boolean;
};
type Child = { firstName: string; lastName: string; dateOfBirth: string; notes: string };

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

const blankChild = (): Child => ({ firstName: "", lastName: "", dateOfBirth: "", notes: "" });

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function clock(t: string) {
  const [h, m] = t.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour}${suffix}` : `${hour}:${String(m).padStart(2, "0")}${suffix}`;
}

export default function RegisterForm({
  parentName,
  parentEmail,
  classId,
  classTitle,
  priceCents,
  others,
}: {
  parentName: string;
  parentEmail: string;
  classId: string;
  classTitle: string;
  priceCents: number;
  others: Other[];
}) {
  const [children, setChildren] = useState<Child[]>([blankChild()]);
  const [extraClasses, setExtraClasses] = useState<string[]>([]);
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
    priceCents + extraClasses.reduce((s, id) => s + (others.find((o) => o.id === id)?.price_cents ?? 0), 0);
  const total = perChild * children.length;

  function setChild(i: number, patch: Partial<Child>) {
    setChildren((cs) => cs.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
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
        child: {
          firstName: child.firstName,
          lastName: child.lastName,
          dateOfBirth: child.dateOfBirth,
          notes: child.notes || null,
        },
      })),
    );

    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey, registrations }),
      });
      const data = await res.json();

      if (!res.ok) {
        if (data.reason === "class_full") {
          const names = (data.fullClasses ?? []).map((c: { title: string }) => c.title).join(", ");
          setError(`Sorry, ${names} filled up while you were registering. Nothing was charged.`);
        } else if (data.reason === "already_enrolled") {
          setError(data.detail);
        } else if (data.reason === "schedule_conflict") {
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
      <section className="kc-card p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-bold text-green-900">Registering as</h2>
            <p className="mt-1.5 font-medium">{parentName}</p>
            <p className="text-sm text-ink-soft">{parentEmail}</p>
          </div>
          <span className="kc-chip kc-chip-accent">Signed in</span>
        </div>
        <p className="mt-4 text-sm text-ink-soft">
          Your keiki are saved to this account, so next term you can register them
          again without typing anything twice.
        </p>
      </section>

      <section className="kc-card p-7">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-display text-xl font-bold text-green-900">
            {children.length === 1 ? "Your child" : "Your children"}
          </h2>
          <button
            type="button" className="kc-btn kc-btn-quiet text-sm"
            onClick={() => setChildren((c) => [...c, blankChild()])}
          >
            Add another child
          </button>
        </div>

        <div className="mt-5 space-y-5">
          {children.map((child, i) => (
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
              <div className="mt-3 grid gap-4 sm:grid-cols-3">
                <div>
                  <label className="kc-label" htmlFor={`fn-${i}`}>First name</label>
                  <input id={`fn-${i}`} className="kc-field" required
                    value={child.firstName}
                    onChange={(e) => setChild(i, { firstName: e.target.value })} />
                </div>
                <div>
                  <label className="kc-label" htmlFor={`ln-${i}`}>Last name</label>
                  <input id={`ln-${i}`} className="kc-field" required
                    value={child.lastName}
                    onChange={(e) => setChild(i, { lastName: e.target.value })} />
                </div>
                <DateField
                  label="Date of birth"
                  required
                  yearsBack={19}
                  value={child.dateOfBirth}
                  onChange={(next) => setChild(i, { dateOfBirth: next })}
                />
                <div className="sm:col-span-3">
                  <label className="kc-label" htmlFor={`notes-${i}`}>
                    Allergies or anything we should know (optional)
                  </label>
                  <input id={`notes-${i}`} className="kc-field"
                    value={child.notes}
                    onChange={(e) => setChild(i, { notes: e.target.value })} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {others.length > 0 && (
        <section className="kc-card p-7">
          <details className="group">
            <summary className="flex cursor-pointer items-center justify-between gap-3 list-none">
              <span>
                <span className="font-display text-xl font-bold text-green-900">
                  Add another class
                </span>
                <span className="ml-2 kc-chip">Optional</span>
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
                      <span className="text-ink-soft"> &middot; {o.school}</span>
                      <span className="mt-0.5 block text-xs text-ink-soft">
                        {DAY_SHORT[o.weekday]} {clock(o.start_time)} to {clock(o.end_time)}
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
