import type { Offering } from "@/lib/catalogue";

/**
 * How many seats are left, said honestly.
 *
 * There are three states a class can be in, and the old code could only express
 * two of them:
 *
 *   - room to spare
 *   - **full, but only because of holds** &mdash; every remaining seat is a
 *     checkout somebody opened minutes ago
 *   - actually full, every seat paid for
 *
 * Collapsing the middle case into "Full" is the expensive mistake. A parent
 * reads "Full", closes the tab, and eight minutes later two of those holds lapse
 * and the seats sit empty with nobody watching. That is a family who wanted to
 * buy and a seat that wanted selling, lost to a rounding decision.
 *
 * So a held seat is shown as held. The bar is two-toned: solid for places that
 * are paid for, hatched amber for places still in checkout. And when the only
 * thing standing between a family and a seat is somebody else's unfinished
 * payment, the page says when that might change instead of telling them to go
 * away.
 *
 * Deliberately not a live countdown on browse pages. A ticking clock on a grid
 * of twelve classes is a pressure tactic and it is also wrong within a second of
 * rendering, because the page is server rendered and cached. "About six
 * minutes" is honest at the precision the data actually has. The one place a
 * real countdown belongs is the checkout the parent themselves has open, where
 * it is their own timer and it matters.
 */

export type SeatState = "open" | "held-out" | "full";

export function seatState(cls: Offering): SeatState {
  if (cls.seatsLeft > 0) return "open";
  return cls.seatsHeld > 0 ? "held-out" : "full";
}

/** "about 6 minutes", or null when there is nothing to wait for. */
export function holdFreesIn(cls: Offering): string | null {
  if (!cls.holdExpiresNext) return null;
  const ms = new Date(cls.holdExpiresNext).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const mins = Math.max(1, Math.round(ms / 60000));
  return mins === 1 ? "under a minute" : `about ${mins} minutes`;
}

/**
 * The chip that sits on a card.
 *
 * "2 seats left" when there are, "3 in checkout" when the class is only full
 * because of holds, "Full" when it genuinely is.
 */
export function SeatChip({ cls }: { cls: Offering }) {
  const state = seatState(cls);

  if (state === "open") {
    const low = cls.seatsLeft <= 3;
    return (
      <span className={`kc-chip ${low ? "kc-chip-warn" : ""}`}>
        {cls.seatsLeft === 1 ? "1 seat left" : `${cls.seatsLeft} seats left`}
      </span>
    );
  }

  if (state === "held-out") {
    return (
      <span className="kc-chip kc-chip-held" title="Seats are in someone else's checkout and may come back">
        {cls.seatsHeld === 1 ? "1 in checkout" : `${cls.seatsHeld} in checkout`}
      </span>
    );
  }

  return <span className="kc-chip">Full</span>;
}

/**
 * The bar. Confirmed places first, then held ones, then whatever is free.
 *
 * `aria-hidden` because the numbers beside it already say this in words, and a
 * progress bar that announces "62 percent" tells a screen reader user nothing
 * they can act on.
 */
export function SeatBar({ cls }: { cls: Offering }) {
  const cap = Math.max(cls.capacity, 1);
  const confirmed = Math.min(cls.seatsConfirmed, cap);
  const held = Math.min(cls.seatsHeld, Math.max(cap - confirmed, 0));

  return (
    <span className="kc-seatbar" aria-hidden>
      <span className="kc-seatbar-confirmed" style={{ width: `${(confirmed / cap) * 100}%` }} />
      <span className="kc-seatbar-held" style={{ width: `${(held / cap) * 100}%` }} />
    </span>
  );
}

/**
 * The line under the bar, in words, and the reason this component exists.
 *
 * The "held-out" sentence is the one that earns its keep: it is the difference
 * between a parent bouncing and a parent coming back.
 */
export function SeatSummary({ cls }: { cls: Offering }) {
  const state = seatState(cls);
  const frees = holdFreesIn(cls);

  if (state === "open") {
    return (
      <p className="kc-seat-note">
        <strong>{cls.seatsConfirmed}</strong> of {cls.capacity} places taken
        {cls.seatsHeld > 0 && (
          <>
            , and <strong>{cls.seatsHeld}</strong> more in checkout right now
          </>
        )}
        .
      </p>
    );
  }

  if (state === "held-out") {
    return (
      <p className="kc-seat-note kc-seat-note-held">
        <strong>Full for the moment.</strong>{" "}
        {cls.seatsHeld === 1 ? "One seat is" : `${cls.seatsHeld} seats are`} in someone
        else&apos;s checkout and {cls.seatsHeld === 1 ? "it" : "they"} may come back if
        {cls.seatsHeld === 1 ? " that payment is" : " those payments are"} not finished
        {frees ? <> &mdash; the first could free up in {frees}</> : null}. Worth checking
        again shortly.
      </p>
    );
  }

  return (
    <p className="kc-seat-note">
      All {cls.capacity} places are taken and paid for.
    </p>
  );
}
