"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * A parent asks to cancel; staff decide.
 *
 * Deliberately a request, not an action. Cancelling instantly would mean
 * deciding a refund automatically, and Keiki Coders has a refund policy we have
 * not seen. The seat stays held while the request is open, so nobody else takes
 * it while the office is deciding.
 */
export function CancelButton({
  enrollmentId,
  child,
}: {
  enrollmentId: string;
  child: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  async function submit() {
    setError(null);
    const res = await fetch("/api/portal/cancel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enrollmentId }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(
        body.error === "not_yours"
          ? "That is not your registration."
          : "Something went wrong. Please try again.",
      );
      return;
    }

    setConfirming(false);
    startTransition(() => router.refresh());
  }

  if (!confirming) {
    return (
      <button className="kc-btn kc-btn-quiet text-sm" onClick={() => setConfirming(true)}>
        Request cancellation
      </button>
    );
  }

  return (
    <div className="w-full rounded-xl border border-hairline bg-paper p-4">
      <p className="text-sm text-ink-soft">
        Ask the office to cancel {child}&apos;s place? They will confirm the refund with
        you before anything is finalised.
      </p>
      {error && <p className="mt-2 text-sm text-sun-deep">{error}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button
          className="kc-btn kc-btn-quiet text-sm"
          onClick={() => setConfirming(false)}
          disabled={pending}
        >
          Keep the place
        </button>
        <button
          className="kc-btn kc-btn-primary text-sm"
          onClick={submit}
          disabled={pending}
        >
          {pending ? "Sending" : "Send request"}
        </button>
      </div>
    </div>
  );
}
