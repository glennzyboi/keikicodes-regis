import Link from "next/link";
import { notFound } from "next/navigation";
import { isUuid } from "@keiki/core/uuid";
import { cachedOfferingById, cachedSessionsFor } from "@/lib/catalogue-cache";
import { GRADE_LABELS } from "@/lib/grades";
import { artFor, ProgramMark } from "../../program-art";
import { timeLabel } from "../../class-card";
import { SeatBar, SeatSummary, seatState } from "../../seats";

export const dynamic = "force-dynamic";

const DAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

function dayLabel(iso: string | null) {
  if (!iso) return "To be confirmed";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return { title: "Keiki Coders" };
  const cls = await cachedOfferingById(id);
  return {
    title: cls ? `${cls.title} at ${cls.school} — Keiki Coders` : "Keiki Coders",
    description: cls?.description ?? undefined,
  };
}

/**
 * One class, in full.
 *
 * A page rather than a modal, and that is the whole decision. A class is a
 * thing parents send each other: "this is the one Kaimana is doing" goes in a
 * message thread, and a modal cannot be linked to, cannot be opened in a new
 * tab, has no title for a preview to read, and disappears on a back gesture.
 * The card carries what somebody decides on; everything that is genuinely
 * detail lives here, where it has an address.
 *
 * Every date the term produces is listed, holidays struck through with the
 * reason. Their own site publishes a `noClass` string; a family reading it has
 * to work out which Wednesdays that leaves. This does the arithmetic for them,
 * and it is the same arithmetic the roster runs on rather than a second copy.
 */
export default async function ProgramDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const cls = await cachedOfferingById(id);
  if (!cls || cls.status !== "published") notFound();

  const sessions = await cachedSessionsFor(cls.id);
  const art = artFor(cls.subject ?? cls.title);
  const external = cls.registrationMode === "external";
  const state = seatState(cls);
  // "Full" is now reserved for every seat being paid for. `held-out` means the
  // remaining seats are open checkouts, which is a different message and a
  // different button.
  const full = !external && state === "full";
  const heldOut = !external && state === "held-out";
  const running = sessions.filter((s) => s.status === "scheduled");
  const off = sessions.filter((s) => s.status === "cancelled");

  const grades =
    cls.gradeLabel ??
    (cls.gradeMin === null && cls.gradeMax === null
      ? null
      : `${GRADE_LABELS[cls.gradeMin ?? 0]} to ${GRADE_LABELS[cls.gradeMax ?? 12]}`);

  return (
    <>
      <section
        className="kc-wash border-b border-hairline"
        style={
          {
            "--kc-accent": art.accent,
            "--kc-soft": art.soft,
            "--kc-ink": art.ink,
          } as React.CSSProperties
        }
      >
        <div className="mx-auto max-w-5xl px-5 py-10 sm:py-14">
          <Link href={`/schools/${cls.schoolSlug}`} className="kc-back">
            <span aria-hidden>&larr;</span> All classes at {cls.school}
          </Link>

          <div className="mt-6 flex flex-wrap items-start gap-5">
            <span className="kc-program-mark kc-program-mark-lg">
              <ProgramMark subject={cls.subject ?? cls.title} />
            </span>
            <div className="min-w-0 flex-1">
              <span className="block font-display text-sm font-semibold uppercase tracking-wider text-green-600">
                {cls.school}
              </span>
              <h1 className="mt-1 font-display text-4xl font-bold leading-tight text-green-900 sm:text-5xl">
                {cls.title}
              </h1>
              {cls.description && (
                <p className="mt-4 max-w-2xl text-lg leading-relaxed text-ink-soft">
                  {cls.description}
                </p>
              )}
            </div>
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            {external ? (
              cls.externalUrl ? (
                <a
                  href={cls.externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="kc-btn kc-btn-primary"
                >
                  Register at {cls.school}
                </a>
              ) : (
                <span className="kc-btn kc-btn-quiet" aria-disabled>
                  Contact the school to register
                </span>
              )
            ) : full ? (
              <span className="kc-btn kc-btn-quiet" aria-disabled>
                This class is full
              </span>
            ) : (
              <Link href={`/register/${cls.id}`} className="kc-btn kc-btn-primary">
                {/* A class whose last seats are open checkouts still gets a live
                    button. The registration transaction is the thing that knows
                    whether a seat exists, and it refuses safely, so letting
                    someone try costs a refusal and turning them away costs a
                    family. */}
                {heldOut ? "Try for a held seat" : "Register for this class"}
              </Link>
            )}

            {!external && cls.priceCents !== null && (
              <span className="font-display text-2xl font-bold text-green-900">
                {money(cls.priceCents)}
                <span className="ml-1.5 font-sans text-sm font-medium text-ink-soft">
                  per child, paid once
                </span>
              </span>
            )}
          </div>

          {external && (
            <p className="mt-4 max-w-2xl rounded-xl border border-hairline bg-white px-4 py-3 text-sm leading-relaxed text-ink-soft">
              {cls.school} runs enrollment for this class themselves. We teach it, they take the
              registration, so their office is the place to sign up and to ask about places.
            </p>
          )}
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-5 py-12">
        <div className="grid gap-8 lg:grid-cols-[1.1fr_1fr]">
          {/* ------------------------------------------------------ the facts */}
          <div>
            <h2 className="font-display text-2xl font-bold text-green-900">The details</h2>

            <dl className="mt-5 divide-y divide-hairline border-y border-hairline">
              <Row label="Campus">{cls.school}</Row>
              {cls.location && cls.location !== cls.school && (
                <Row label="Where">{cls.location}</Row>
              )}
              <Row label="Every">
                {DAYS[cls.weekday]}, {timeLabel(cls.startTime)} to {timeLabel(cls.endTime)}
              </Row>
              <Row label="Runs">
                {dayLabel(cls.firstSession)} to {dayLabel(cls.lastSession)}
              </Row>
              <Row label="Length">
                {cls.sessionCount} {cls.sessionCount === 1 ? "session" : "sessions"}
                {off.length > 0 &&
                  `, with ${off.length} ${off.length === 1 ? "holiday" : "holidays"} already taken out`}
              </Row>
              {grades && <Row label="Grades">{grades}</Row>}
              <Row label="Term">{cls.term}</Row>
              {!external && (
                <Row label="Class size">
                  {cls.capacity} places, {Math.max(cls.seatsLeft, 0)} still free
                </Row>
              )}
            </dl>

            {!external && (
              <div className="mt-5">
                <SeatBar cls={cls} />
                <SeatSummary cls={cls} />
              </div>
            )}

            {cls.specialNotes && (
              <p className="mt-6 rounded-xl bg-sun-soft px-4 py-3 text-sm leading-relaxed text-ink">
                {cls.specialNotes}
              </p>
            )}

            <p className="mt-6 text-sm leading-relaxed text-ink-soft">
              Held on your child&apos;s own campus straight after school, so there is no second
              pickup to arrange. Everything is supplied and there is nothing to bring.
            </p>
          </div>

          {/* ----------------------------------------------------- every date */}
          <div>
            <h2 className="font-display text-2xl font-bold text-green-900">
              Every date
              <span className="ml-2 align-middle text-base font-medium text-ink-soft">
                {running.length} running
              </span>
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              Holidays and closures are shown struck through, with the reason, rather than
              left as gaps you have to work out.
            </p>

            <ol className="mt-5 max-h-[28rem] overflow-y-auto rounded-xl border border-hairline bg-white">
              {sessions.map((s, i) => (
                <li
                  key={`${s.date}-${i}`}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-4 py-2.5 text-sm last:border-b-0"
                >
                  <span
                    className={
                      s.status === "scheduled" ? "font-medium" : "line-through opacity-60"
                    }
                  >
                    {dayLabel(s.date)}
                  </span>
                  <span className="text-ink-soft">
                    {s.status === "scheduled"
                      ? timeLabel(cls.startTime)
                      : (s.note ?? (s.status === "cancelled" ? "No class" : "Moved"))}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-4 py-3">
      <dt className="font-display text-sm font-semibold uppercase tracking-wide text-green-600">
        {label}
      </dt>
      <dd className="text-right text-ink">{children}</dd>
    </div>
  );
}
