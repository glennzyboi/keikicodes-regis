"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PARENT_CANCEL_REASONS } from "@keiki/core/schedule-reasons";
import { Modal } from "@/components/modal";

/**
 * A parent asks to cancel, and says why.
 *
 * Deliberately a request, not an action. Cancelling instantly would mean
 * deciding a refund automatically, and Keiki Coders has a refund policy we have
 * not seen. The seat stays held while the request is open, so nobody else takes
 * it while the office is deciding.
 *
 * The reason is the part that is new, and it is worth a sentence on camera.
 * Asking "why" at the moment somebody leaves is the cheapest research a
 * business ever gets, and it costs the family one tap. A fixed list because
 * free text alone gives you "N/A" and forty different spellings of "the time
 * clashed"; a note box as well because no list survives a real reason. Choosing
 * "another reason" makes the note required, since an unexplained shrug is the
 * same as no answer.
 *
 * A dialog rather than a panel inside the card. The card is a summary somebody
 * is reading; growing a form inside it pushes everything below off the screen
 * mid-thought.
 */
export function CancelButton({
  enrollmentId,
  child,
  className,
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

    // Checked here as well as on the server. The server is the one that
    // matters; this one exists so the answer is instant rather than a round
    // trip away.
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
      const res = await fetch("/api/portal/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enrollmentId, reasonCode: reason, note: note.trim() || undefined }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(
          body.error === "not_yours"
            ? "That is not your registration, or it has already been cancelled."
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
      <button type="button" className={className} onClick={() => setOpen(true)}>
        Request cancellation
      </button>

      {open && (
        <Modal
          title={`Cancel ${child}'s place?`}
          description="The office will confirm the refund with you before anything is finalised. Their seat stays yours until they do."
          onClose={close}
          width={520}
        >
          {sent ? (
            <div>
              <p className="rounded-xl bg-green-100 px-4 py-3 text-sm text-green-900">
                Thank you. We have your request and the office will be in touch about the
                refund.
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
                <label htmlFor={`why-${enrollmentId}`}>Why are you cancelling?</label>
                <select
                  id={`why-${enrollmentId}`}
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value);
                    setError(null);
                  }}
                  aria-invalid={Boolean(error && !reason)}
                  aria-describedby={error ? `cancel-error-${enrollmentId}` : undefined}
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
                <label htmlFor={`note-${enrollmentId}`}>
                  Anything else we should know?{" "}
                  <span className="font-normal text-ink-soft">
                    {needsNote ? "(required)" : "(optional)"}
                  </span>
                </label>
                <textarea
                  id={`note-${enrollmentId}`}
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
                  id={`cancel-error-${enrollmentId}`}
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
                  {busy ? "Sending" : "Send request"}
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </>
  );
}
