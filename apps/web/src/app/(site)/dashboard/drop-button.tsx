"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PARENT_CANCEL_REASONS } from "@keiki/core/schedule-reasons";
import { Modal } from "@/components/modal";

/**
 * A parent drops their child from a class.
 *
 * Different from a cancellation and the difference is the point. Cancelling is
 * a request that waits on an admin decision and usually ends in money going
 * back. Dropping is a fact: the family is done, the seat is freed, and no
 * refund is assumed.
 *
 * The dialog follows the same structure as the cancel button — a reason from a
 * fixed list, an optional note, "other" forces the note — so the data quality
 * is identical and the office can compare drop reasons with cancel reasons at
 * the end of term.
 *
 * If the family does want money back, the cancel button still exists for that
 * and says so explicitly.
 */
export function DropButton({
  enrollmentId,
  child,
  className: cssClass,
}: {
  enrollmentId: string;
  child: string;
  className: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const needsNote = reason === "other";
  const noteTooShort = needsNote && note.trim().length < 3;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!reason) {
      setError("Please choose a reason so we know how to help.");
      return;
    }
    if (noteTooShort) {
      setError("Please tell us a little about why.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/portal/drop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enrollmentId, reasonCode: reason, note: note.trim() || undefined }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(
          body.error === "not_yours"
            ? "That registration was not found, or it has already been dropped."
            : body.error === "not_signed_in"
              ? "Your session has expired. Please sign in again."
              : (body.message ?? "Something went wrong. Please try again."),
        );
        return;
      }

      setSent(true);
      startTransition(() => router.refresh());
    } catch {
      setError("We could not reach the server. Please check your connection.");
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setOpen(false);
    setError(null);
    if (sent) {
      setSent(false);
      setReason("");
      setNote("");
    }
  }

  return (
    <>
      <button type="button" className={cssClass} onClick={() => setOpen(true)}>
        Drop from class
      </button>

      {open && (
        <Modal
          title={`Drop ${child} from this class?`}
          description="The seat is freed straight away. No refund is processed — if you need one, use &ldquo;Request cancellation &amp; refund&rdquo; instead."
          onClose={close}
          width={520}
        >
          {sent ? (
            <div>
              <p className="rounded-xl bg-green-100 px-4 py-3 text-sm text-green-900">
                Done. {child} has been dropped from the class. If you have questions about a
                refund, please get in touch with the office.
              </p>
              <div className="mt-4 flex justify-end">
                <button type="button" className="kc-btn kc-btn-primary text-sm" onClick={close}>
                  Close
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} noValidate>
              <div className="kc-fieldset">
                <label htmlFor={`drop-why-${enrollmentId}`}>Why are you leaving?</label>
                <select
                  id={`drop-why-${enrollmentId}`}
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value);
                    setError(null);
                  }}
                  aria-invalid={Boolean(error && !reason)}
                  aria-describedby={error ? `drop-error-${enrollmentId}` : undefined}
                  required
                >
                  <option value="" disabled>
                    Choose a reason
                  </option>
                  {PARENT_CANCEL_REASONS.map((r) => (
                    <option key={r.code} value={r.code}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="kc-fieldset mt-4">
                <label htmlFor={`drop-note-${enrollmentId}`}>
                  Anything else we should know?{" "}
                  <span className="font-normal text-ink-soft">
                    {needsNote ? "(required)" : "(optional)"}
                  </span>
                </label>
                <textarea
                  id={`drop-note-${enrollmentId}`}
                  rows={3}
                  maxLength={1000}
                  value={note}
                  onChange={(e) => {
                    setNote(e.target.value);
                    setError(null);
                  }}
                  aria-invalid={Boolean(error && noteTooShort)}
                  placeholder="It helps us make the classes better."
                />
                <p className="mt-1 text-xs text-ink-soft">{note.length}/1000</p>
              </div>

              {error && (
                <p
                  id={`drop-error-${enrollmentId}`}
                  role="alert"
                  className="mt-3 rounded-xl border border-sun-deep bg-sun-soft/50 px-4 py-3 text-sm text-ink"
                >
                  {error}
                </p>
              )}

              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  className="kc-btn kc-btn-quiet text-sm"
                  onClick={close}
                  disabled={busy || pending}
                >
                  Keep the place
                </button>
                <button
                  type="submit"
                  className="kc-btn kc-btn-primary text-sm"
                  disabled={busy || pending}
                >
                  {busy ? "Dropping" : "Drop from class"}
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </>
  );
}
