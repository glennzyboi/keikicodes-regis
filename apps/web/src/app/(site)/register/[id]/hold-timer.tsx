"use client";

import { useEffect, useState } from "react";

/**
 * How long this family's seats are held for, counting down.
 *
 * A hold is a promise the system makes and then quietly breaks. Before this,
 * the page said "seats are held for 30 minutes" once, in the past tense of a
 * decision already made, and then said nothing while the clock ran. A parent
 * who went to find their card came back to a page that looked identical whether
 * they had eight minutes left or none.
 *
 * So the promise is shown being kept. It is their own timer, on their own
 * checkout, about a seat they are actively trying to buy: that is the one place
 * in the product where a countdown is information rather than a pressure
 * tactic, which is why there is deliberately no ticking clock on the browse
 * pages.
 *
 * ## Why it counts from a server timestamp
 *
 * `expiresAt` is the real `seat_holds.expires_at` read back from the database,
 * not `now + 10 minutes` computed here. Two reasons, and the second is the one
 * that bites: a resubmitted registration reuses its original hold, so a parent
 * who comes back four minutes later genuinely has six minutes, and a locally
 * computed timer would show ten and expire the seat while still reading 04:00.
 *
 * The clock can still be wrong, because it is the visitor's clock and those
 * drift. Everything that matters is decided server side by comparing timestamps
 * in Postgres; this is a display of that, and being a few seconds out is
 * harmless in a way that being four minutes out is not.
 */
export function HoldTimer({ expiresAt }: { expiresAt: string | null }) {
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!expiresAt) return;
    const target = new Date(expiresAt).getTime();
    if (!Number.isFinite(target)) return;

    const tick = () => setLeft(Math.max(0, Math.round((target - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  // Nothing to say until the client has read the clock. Rendering "10:00" on
  // the server and then correcting it on hydration is a visible jump for a
  // number people are watching.
  if (left === null) return null;

  const expired = left === 0;
  const urgent = !expired && left <= 120;
  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");

  return (
    <div className="kc-hold" data-state={expired ? "expired" : urgent ? "urgent" : "holding"}>
      <div className="kc-hold-row">
        <span className="kc-hold-label">
          {expired ? "Your hold has expired" : "Seats held for"}
        </span>
        {!expired && (
          <span
            className="kc-hold-clock"
            // Announced when it becomes urgent, not every second. A screen
            // reader reciting the time once per second is unusable, and the
            // interesting moment is "you are running out", not "it is 07:43".
            aria-live={urgent ? "polite" : "off"}
            aria-atomic="true"
          >
            <span className="sr-only">{`${Math.floor(left / 60)} minutes ${left % 60} seconds remaining`}</span>
            {/* The digits carry their own class so a test can assert on what is
                actually shown. Reading the whole element picks up the screen
                reader sentence above as well, which is correct for a screen
                reader and useless as an assertion. */}
            <span className="kc-hold-digits" aria-hidden>
              {mm}:{ss}
            </span>
          </span>
        )}
      </div>

      <p className="kc-hold-note">
        {expired ? (
          <>
            These seats have gone back to the class and somebody else may take them. Finishing
            the payment below will still try to keep your place, and if the class has filled we
            will hold it for you anyway and get in touch.
          </>
        ) : (
          <>
            Nobody else can take these seats while the timer runs. If it reaches zero before you
            pay, they go back to the class for the next family.
          </>
        )}
      </p>
    </div>
  );
}
