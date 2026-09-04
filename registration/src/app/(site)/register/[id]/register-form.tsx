"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { HOLD_MINUTES } from "@/lib/holds";

type Other = { id: string; title: string; school: string; price_cents: number; left: number };
type Child = { firstName: string; lastName: string; dateOfBirth: string; notes: string };

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

const blankChild = (): Child => ({ firstName: "", lastName: "", dateOfBirth: "", notes: "" });

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
                <div>
                  <label className="kc-label" htmlFor={`dob-${i}`}>Date of birth</label>
                  <input id={`dob-${i}`} className="kc-field" type="date" required
                    value={child.dateOfBirth}
                    onChange={(e) => setChild(i, { dateOfBirth: e.target.value })} />
                </div>
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
          <h2 className="font-display text-xl font-bold text-green-900">Add another class</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Anything you add applies to every child above, and it is all one payment.
          </p>
          <div className="mt-4 space-y-2">
            {others.map((o) => (
              <label
                key={o.id}
                className="flex cursor-pointer items-center gap-3 rounded-[var(--radius-field)] border-2 border-hairline p-3 transition-colors hover:border-green-200"
              >
                <input
                  type="checkbox" className="h-5 w-5 accent-green-700"
                  checked={extraClasses.includes(o.id)}
                  onChange={(e) =>
                    setExtraClasses((v) =>
                      e.target.checked ? [...v, o.id] : v.filter((x) => x !== o.id),
                    )
                  }
                />
                <span className="flex-1">
                  <span className="font-display font-semibold">{o.title}</span>
                  <span className="text-ink-soft"> &middot; {o.school}</span>
                </span>
                <span className="font-display font-semibold text-green-900">
                  {money(o.price_cents)}
                </span>
              </label>
            ))}
          </div>
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
