"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { saveOffering, deleteOffering, duplicateOffering } from "../actions";
import { GRADE_LABELS } from "@/lib/grades";
import type { OfferingRow } from "../queries";

/**
 * The class editor.
 *
 * The thing that makes this better than the spreadsheet it replaces is the
 * preview on the right. A schedule is not four fields, it is the twenty
 * afternoons those four fields produce, and until you can see them you are
 * guessing. It counts as you type: change the end date and the number moves,
 * add a holiday and it drops by one.
 *
 * That number is the one their families count. Their own records carry it and
 * getting it wrong by one is a phone call.
 *
 * The other half is what the form refuses. Capacity below the seats already
 * taken, a price change with families already paid, a schedule move without
 * telling anybody: each is either blocked or asks a direct question first, with
 * the number of affected families in it. A spreadsheet lets you do all three
 * silently, which is the actual reason to move off one.
 */

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type Picker = { schools: { id: string; name: string }[]; programs: { id: string; name: string; track: string | null }[]; terms: { id: string; name: string; is_current: boolean }[] };

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

/** Every date the schedule produces, with the holidays marked. */
function projectSessions(
  first: string,
  last: string,
  weekday: number,
  blackouts: Set<string>,
): { date: string; blacked: boolean }[] {
  if (!first || !last || last < first) return [];
  const out: { date: string; blacked: boolean }[] = [];
  const start = new Date(`${first}T00:00:00Z`);
  const end = new Date(`${last}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];

  // Walk to the first matching weekday rather than assuming, so the preview is
  // honest about a start date that does not match the chosen day.
  const cursor = new Date(start);
  cursor.setUTCDate(cursor.getUTCDate() + ((weekday - cursor.getUTCDay() + 7) % 7));

  let guard = 0;
  while (cursor <= end && guard++ < 400) {
    const key = cursor.toISOString().slice(0, 10);
    out.push({ date: key, blacked: blackouts.has(key) });
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return out;
}

const pretty = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
};

export function OfferingForm({
  offering,
  pickers,
  enrolled,
  existingSessions,
}: {
  offering: OfferingRow | null;
  pickers: Picker;
  enrolled: number;
  existingSessions: { date: string; status: string; note: string | null; origin: string }[];
}) {
  const [state, action, pending] = useActionState(saveOffering, null);
  const [, deleteAction, deleting] = useActionState(deleteOffering, null);
  const [, dupeAction] = useActionState(duplicateOffering, null);

  const [schoolId, setSchoolId] = useState(offering?.schoolId ?? pickers.schools[0]?.id ?? "");
  const [programId, setProgramId] = useState(offering?.programId ?? pickers.programs[0]?.id ?? "");
  const [termId, setTermId] = useState(
    offering?.termId ?? pickers.terms.find((t) => t.is_current)?.id ?? pickers.terms[0]?.id ?? "",
  );
  const [title, setTitle] = useState(offering?.title ?? "");
  const [weekday, setWeekday] = useState(offering?.weekday ?? 2);
  const [startTime, setStartTime] = useState((offering?.startTime ?? "15:00:00").slice(0, 5));
  const [endTime, setEndTime] = useState((offering?.endTime ?? "16:00:00").slice(0, 5));
  const [firstDate, setFirstDate] = useState(offering?.firstSessionDate ?? "");
  const [lastDate, setLastDate] = useState(offering?.lastSessionDate ?? "");
  const [capacity, setCapacity] = useState(String(offering?.capacity ?? 16));
  const [price, setPrice] = useState(
    offering?.priceCents === null || offering?.priceCents === undefined
      ? ""
      : String(offering.priceCents / 100),
  );
  const [mode, setMode] = useState(offering?.registrationMode ?? "keiki_coders");
  const [externalUrl, setExternalUrl] = useState(offering?.externalUrl ?? "");
  const [gradeMin, setGradeMin] = useState(offering?.gradeMin === null || offering?.gradeMin === undefined ? "" : String(offering.gradeMin));
  const [gradeMax, setGradeMax] = useState(offering?.gradeMax === null || offering?.gradeMax === undefined ? "" : String(offering.gradeMax));
  const [status, setStatus] = useState(offering?.status ?? "draft");
  const [location, setLocation] = useState(offering?.location ?? "");
  const [notes, setNotes] = useState(offering?.specialNotes ?? "");
  const [blackoutText, setBlackoutText] = useState((offering?.blackouts ?? []).join("\n"));
  const [notify, setNotify] = useState(true);

  const blackouts = useMemo(
    () =>
      new Set(
        blackoutText
          .split(/[\n,]/)
          .map((s) => s.trim())
          .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s)),
      ),
    [blackoutText],
  );

  const projected = useMemo(
    () => projectSessions(firstDate, lastDate, weekday, blackouts),
    [firstDate, lastDate, weekday, blackouts],
  );
  const willRun = projected.filter((p) => !p.blacked).length;

  // A holiday nobody will ever meet, because it is not on the class weekday.
  // Their own records are full of these, copied between programs at a campus.
  const strayBlackouts = [...blackouts].filter(
    (d) => !projected.some((p) => p.date === d),
  );

  const dateMismatch =
    firstDate !== "" &&
    new Date(`${firstDate}T00:00:00Z`).getUTCDay() !== weekday &&
    !Number.isNaN(new Date(`${firstDate}T00:00:00Z`).getTime());

  const shrinkingBelowTaken = offering !== null && Number(capacity) < offering.seatsTaken;
  const priceChanged =
    offering !== null &&
    offering.priceCents !== null &&
    price !== "" &&
    Math.round(Number(price) * 100) !== offering.priceCents;
  const scheduleMoved =
    offering !== null &&
    (offering.weekday !== weekday ||
      offering.startTime.slice(0, 5) !== startTime ||
      offering.endTime.slice(0, 5) !== endTime ||
      offering.firstSessionDate !== firstDate ||
      offering.lastSessionDate !== lastDate);

  const manualEdits = existingSessions.filter(
    (s) => s.origin === "manual" || (s.status === "cancelled" && s.note && s.note !== "No class"),
  );

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <form action={action} className="space-y-5">
        {offering && <input type="hidden" name="offeringId" value={offering.id} />}
        <input type="hidden" name="blackoutDates" value={blackoutText} />
        <input type="hidden" name="notifyFamilies" value={notify ? "on" : ""} />

        {/* ------------------------------------------------------ identity */}
        <section className="ops-panel p-4">
          <h2 className="ops-panel-head">What it is</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="ops-label">Program</span>
              <select
                name="programId"
                className="ops-field w-full"
                value={programId}
                onChange={(e) => {
                  setProgramId(e.target.value);
                  const p = pickers.programs.find((x) => x.id === e.target.value);
                  if (p && !title) setTitle(p.name);
                }}
              >
                {pickers.programs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[var(--ops-muted)]">
                The curriculum. Reused across campuses and terms.
              </span>
            </label>

            <label className="block">
              <span className="ops-label">Campus</span>
              <select
                name="schoolId"
                className="ops-field w-full"
                value={schoolId}
                onChange={(e) => setSchoolId(e.target.value)}
              >
                {pickers.schools.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block sm:col-span-2">
              <span className="ops-label">Title families see</span>
              <input
                name="title"
                className="ops-field w-full"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <span className="mt-1 block text-[var(--ops-muted)]">
                Usually the program name. Add a qualifier when a campus runs it twice, the
                way Liholiho splits A+ and non A+.
              </span>
            </label>

            <label className="block">
              <span className="ops-label">Term</span>
              <select
                name="termId"
                className="ops-field w-full"
                value={termId}
                onChange={(e) => setTermId(e.target.value)}
              >
                {pickers.terms.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.is_current ? " (current)" : ""}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="ops-label">Status</span>
              <select
                name="status"
                className="ops-field w-full"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="draft">Draft, not listed</option>
                <option value="published">Published, open to families</option>
                <option value="closed">Closed, listed but no new registrations</option>
              </select>
            </label>
          </div>
        </section>

        {/* ------------------------------------------------------ schedule */}
        <section className="ops-panel p-4">
          <h2 className="ops-panel-head">When it runs</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="ops-label">Day</span>
              <select
                name="weekday"
                className="ops-field w-full"
                value={weekday}
                onChange={(e) => setWeekday(Number(e.target.value))}
              >
                {DAYS.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="ops-label">Starts</span>
              <input
                type="time"
                name="startTime"
                className="ops-field w-full"
                required
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="ops-label">Ends</span>
              <input
                type="time"
                name="endTime"
                className="ops-field w-full"
                required
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </label>

            <label className="block">
              <span className="ops-label">First session</span>
              <input
                type="date"
                name="firstSessionDate"
                className="ops-field w-full"
                required
                value={firstDate}
                onChange={(e) => setFirstDate(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="ops-label">Last session</span>
              <input
                type="date"
                name="lastSessionDate"
                className="ops-field w-full"
                required
                value={lastDate}
                onChange={(e) => setLastDate(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="ops-label">Room or location</span>
              <input
                name="location"
                className="ops-field w-full"
                placeholder="Optional"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </label>

            <label className="block sm:col-span-3">
              <span className="ops-label">Holidays and closures</span>
              <textarea
                className="ops-field w-full font-[var(--ops-mono-font,inherit)]"
                rows={3}
                placeholder={"2026-11-11\n2026-11-25"}
                value={blackoutText}
                onChange={(e) => setBlackoutText(e.target.value)}
              />
              <span className="mt-1 block text-[var(--ops-muted)]">
                One date a line, as YYYY-MM-DD. These become cancelled sessions rather than
                gaps, so a family sees why there is no class that week.
              </span>
            </label>
          </div>

          {dateMismatch && (
            <p className="ops-warn mt-3">
              The first session is not on a {DAYS[weekday]}. Pick a {DAYS[weekday]}, or change
              the day, or the dates below will not be the ones you expect.
            </p>
          )}

          {strayBlackouts.length > 0 && (
            <p className="ops-warn mt-3">
              {strayBlackouts.length} of these dates are not on a {DAYS[weekday]}, so this
              class never meets them: {strayBlackouts.join(", ")}. Harmless, and worth
              knowing before somebody counts the sessions.
            </p>
          )}
        </section>

        {/* -------------------------------------------------- who and how much */}
        <section className="ops-panel p-4">
          <h2 className="ops-panel-head">Who it is for, and who takes the money</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="ops-label">Lowest grade</span>
              <select
                name="gradeMin"
                className="ops-field w-full"
                value={gradeMin}
                onChange={(e) => setGradeMin(e.target.value)}
              >
                <option value="">Any</option>
                {GRADE_LABELS.map((l, g) => (
                  <option key={l} value={g}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="ops-label">Highest grade</span>
              <select
                name="gradeMax"
                className="ops-field w-full"
                value={gradeMax}
                onChange={(e) => setGradeMax(e.target.value)}
              >
                <option value="">Any</option>
                {GRADE_LABELS.map((l, g) => (
                  <option key={l} value={g}>
                    {l}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="ops-label">Seats</span>
              <input
                type="number"
                name="capacity"
                min={1}
                max={500}
                className="ops-field w-full"
                required
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
              />
              {offering && (
                <span className="mt-1 block text-[var(--ops-muted)]">
                  {offering.seatsTaken} taken.
                </span>
              )}
            </label>

            <label className="block">
              <span className="ops-label">Registration</span>
              <select
                name="registrationMode"
                className="ops-field w-full"
                value={mode}
                onChange={(e) => setMode(e.target.value)}
              >
                <option value="keiki_coders">We take it, and the payment</option>
                <option value="external">The school takes it</option>
              </select>
            </label>

            {mode === "keiki_coders" ? (
              <label className="block">
                <span className="ops-label">Price per child</span>
                <div className="flex items-center gap-2">
                  <span className="text-[var(--ops-muted)]">$</span>
                  <input
                    type="number"
                    min={0}
                    step="1"
                    className="ops-field w-full"
                    required
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                  />
                </div>
                <input
                  type="hidden"
                  name="priceCents"
                  value={price === "" ? "" : String(Math.round(Number(price) * 100))}
                />
              </label>
            ) : (
              <input type="hidden" name="priceCents" value="" />
            )}

            {mode === "external" ? (
              <label className="block sm:col-span-2">
                <span className="ops-label">Where families go to register</span>
                <input
                  name="externalRegistrationUrl"
                  type="url"
                  className="ops-field w-full"
                  required
                  placeholder="https://www.iolani.org/after-school-programs"
                  value={externalUrl}
                  onChange={(e) => setExternalUrl(e.target.value)}
                />
                <span className="mt-1 block text-[var(--ops-muted)]">
                  The class is listed with no Register button, and the registration endpoint
                  refuses it, so it cannot be paid for here by accident.
                </span>
              </label>
            ) : (
              <input type="hidden" name="externalRegistrationUrl" value="" />
            )}

            <label className="block sm:col-span-2">
              <span className="ops-label">Note for families</span>
              <textarea
                name="specialNotes"
                className="ops-field w-full"
                rows={2}
                placeholder="Optional. Shown on the class card."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
          </div>
        </section>

        {/* --------------------------------------------------- consequences */}
        {(shrinkingBelowTaken || priceChanged || (scheduleMoved && enrolled > 0)) && (
          <section className="ops-panel p-4">
            <h2 className="ops-panel-head">Before you save</h2>
            <ul className="mt-3 space-y-2">
              {shrinkingBelowTaken && (
                <li className="ops-warn">
                  {offering!.seatsTaken} seats are taken, so a capacity of {capacity} will be
                  refused. Cancel a registration first if the class really has to be smaller.
                </li>
              )}
              {priceChanged && offering!.seatsTaken > 0 && (
                <li className="ops-warn">
                  {offering!.seatsTaken} {offering!.seatsTaken === 1 ? "family has" : "families have"}{" "}
                  already paid {money(offering!.priceCents!)}. They keep that price; the new one
                  applies to registrations from now on.
                </li>
              )}
              {scheduleMoved && enrolled > 0 && (
                <li>
                  <label className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={notify}
                      onChange={(e) => setNotify(e.target.checked)}
                    />
                    <span>
                      <span className="font-medium">
                        Email the {enrolled} {enrolled === 1 ? "family" : "families"} in this
                        class about the new schedule
                      </span>
                      <span className="mt-0.5 block text-[var(--ops-muted)]">
                        Queued in the same transaction as the change, so they are told if and
                        only if it actually saved. Sending twice is prevented by the message
                        key, so pressing save again does not mail everybody again.
                      </span>
                    </span>
                  </label>
                </li>
              )}
            </ul>
          </section>
        )}

        {state && (
          <p className={state.ok ? "ops-ok" : "ops-warn"} role="status">
            {state.ok ? state.message : state.error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button className="ops-btn ops-btn-primary" disabled={pending}>
            {pending ? "Saving..." : offering ? "Save changes" : "Create class"}
          </button>
          <Link href="/admin/catalogue/classes" className="ops-btn">
            Back to classes
          </Link>
          {offering && (
            <span className="ml-auto text-[var(--ops-muted)]">
              {offering.stripePriceId ? `Stripe ${offering.stripePriceId}` : "Not in Stripe"}
            </span>
          )}
        </div>
      </form>

      {/* ---------------------------------------------------------- preview */}
      <aside className="space-y-4">
        <div className="ops-panel p-4">
          <h2 className="ops-panel-head">The schedule this makes</h2>
          <p className="ops-stat-value mt-2">{willRun}</p>
          <p className="text-[var(--ops-muted)]">
            sessions will run
            {blackouts.size > 0 &&
              `, with ${projected.length - willRun} cancelled for holidays`}
          </p>

          {projected.length === 0 ? (
            <p className="mt-3 text-[var(--ops-muted)]">
              Set a first and last date to see the dates.
            </p>
          ) : (
            <ol className="mt-3 max-h-72 space-y-1 overflow-y-auto pr-1">
              {projected.map((p, i) => (
                <li
                  key={p.date}
                  className="flex items-baseline justify-between gap-2 border-b border-[var(--ops-line)] pb-1 last:border-0"
                >
                  <span className={p.blacked ? "text-[var(--ops-faint)] line-through" : ""}>
                    {pretty(p.date)}
                  </span>
                  <span className="text-[var(--ops-muted)]">
                    {p.blacked ? "no class" : `#${i + 1 - projected.slice(0, i).filter((x) => x.blacked).length}`}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>

        {offering && manualEdits.length > 0 && (
          <div className="ops-panel p-4">
            <h2 className="ops-panel-head">Changes made by hand</h2>
            <p className="mt-2 text-[var(--ops-muted)]">
              Saving regenerates the schedule and leaves every one of these exactly as it is.
            </p>
            <ul className="mt-3 space-y-1">
              {manualEdits.map((s) => (
                <li key={s.date} className="flex justify-between gap-2">
                  <span>{pretty(s.date)}</span>
                  <span className="text-[var(--ops-muted)]">{s.note ?? s.status}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {offering && (
          <>
            <div className="ops-panel p-4">
              <h2 className="ops-panel-head">Copy to another campus</h2>
              <p className="mt-2 text-[var(--ops-muted)]">
                Same program, same times, same holidays, as a draft.
              </p>
              <form action={dupeAction} className="mt-3 flex gap-2">
                <input type="hidden" name="offeringId" value={offering.id} />
                <select name="toSchoolId" className="ops-field w-full" defaultValue="">
                  <option value="" disabled>
                    Pick a campus
                  </option>
                  {pickers.schools
                    .filter((s) => s.id !== offering.schoolId)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>
                <button className="ops-btn">Copy</button>
              </form>
            </div>

            <div className="ops-panel p-4">
              <h2 className="ops-panel-head">Remove</h2>
              <p className="mt-2 text-[var(--ops-muted)]">
                {enrolled > 0
                  ? `${enrolled} ${enrolled === 1 ? "child is" : "children are"} registered, so this will be refused. Set the class to closed instead.`
                  : "Nobody is registered, so this can be deleted."}
              </p>
              <form action={deleteAction} className="mt-3">
                <input type="hidden" name="offeringId" value={offering.id} />
                <button className="ops-btn ops-btn-danger" disabled={deleting || enrolled > 0}>
                  Delete this class
                </button>
              </form>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
