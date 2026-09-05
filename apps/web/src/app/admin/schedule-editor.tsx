"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { CANCEL_REASONS } from "@keiki/core/schedule-reasons";
import {
  addSessionAction,
  cancelSessionsAction,
  moveSessionAction,
  restoreSessionAction,
  shiftSessionsAction,
  type ScheduleState,
} from "./schedule-actions";
import { Icon, Pill } from "./ui";
import { Modal } from "@/components/modal";

/**
 * The term, under the office's hands.
 *
 * What this replaces was two buttons, "Cancel next class" and "Move next
 * class", which acted only on whichever date happened to be next. That is a
 * model of a school year in which nothing ever goes wrong twice, and it could
 * not express a single one of the things an office actually rings up about:
 * the whole week after Thanksgiving is off, week 12 has to move because the
 * hall is booked, the term starts a week late so everything shifts, we owe them
 * a make up class for the storm, and somebody cancelled the wrong Tuesday.
 *
 * So the unit of work is a selection, not a button. Tick the dates, then say
 * what happens to them. Everything else follows from that:
 *
 *   - A **reason** is required, from a fixed list, because "why was week 9 off"
 *     is a question somebody asks in February and free text answers it with
 *     "N/A", "sick" and "Sick teacher" in three different rows.
 *   - **Telling the families is a choice, and it is on by default.** Fixing a
 *     typo should not email four hundred people; cancelling a class should.
 *   - Every refusal is a sentence. Moving onto a date that already has a class
 *     is the common mistake, and it says so rather than throwing.
 *
 * **Every form is a dialog, and none of them are in the table.** They started
 * inside the cell of the row they acted on, which works for two buttons and
 * falls apart the moment a reason picker, a note field and a refusal sentence
 * share a `<td>`: the row grew to five times its height and pulled every other
 * column out of line. A table is for reading. Anything you type goes on top of
 * it.
 *
 * The table itself is deliberately plain. Staff read this page every morning,
 * so nothing animates, nothing slides, and the row under the cursor changes
 * colour and nothing else.
 */

export type EditorSession = {
  id: string;
  seq: number;
  date: string;
  label: string;
  time: string;
  status: "scheduled" | "cancelled" | "rescheduled";
  reasonCode: string | null;
  reasonLabel: string | null;
  note: string | null;
  isReplacement: boolean;
  fromBlackout: boolean;
  manual: boolean;
  past: boolean;
  changedBy: string | null;
};

type Panel =
  | { kind: "none" }
  | { kind: "cancel" }
  | { kind: "shift" }
  | { kind: "add" }
  | { kind: "move"; session: EditorSession }
  | { kind: "restore"; session: EditorSession };

export function ScheduleEditor({
  classOfferingId,
  sessions,
  defaultStart,
  defaultEnd,
  enrolled,
}: {
  classOfferingId: string;
  sessions: EditorSession[];
  defaultStart: string;
  defaultEnd: string;
  enrolled: number;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [panel, setPanel] = useState<Panel>({ kind: "none" });
  const [showOff, setShowOff] = useState(true);

  const visible = useMemo(
    () => (showOff ? sessions : sessions.filter((s) => s.status === "scheduled")),
    [sessions, showOff],
  );

  const offCount = sessions.length - sessions.filter((s) => s.status === "scheduled").length;
  const chosen = sessions.filter((s) => selected.has(s.id));
  // A date that already moved is history, not something to move again.
  const movable = chosen.filter((s) => s.status !== "rescheduled");
  const upcoming = visible.filter((s) => !s.past && s.status === "scheduled");

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const close = () => setPanel({ kind: "none" });
  /** A change landed, so the selection it was made from is spent. */
  const finished = () => {
    setPanel({ kind: "none" });
    setSelected(new Set());
  };

  return (
    <div>
      {/* ------------------------------------------------------------- bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--ops-line)] px-4 py-3">
        <button
          type="button"
          className="ops-btn"
          onClick={() => setSelected(new Set(upcoming.map((s) => s.id)))}
          disabled={upcoming.length === 0}
        >
          Select all upcoming
        </button>

        {/* The commonest real request, one click: everything from here to the
            end of term. A term that slips does not slip from week one. */}
        <button
          type="button"
          className="ops-btn"
          onClick={() =>
            setSelected(
              new Set(
                visible.filter((s) => !s.past && s.status !== "rescheduled").map((s) => s.id),
              ),
            )
          }
          disabled={visible.every((s) => s.past)}
        >
          Select rest of term
        </button>

        {selected.size > 0 && (
          <button type="button" className="ops-btn" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        )}

        <span className="ml-auto flex items-center gap-3">
          {offCount > 0 && (
            <label className="flex cursor-pointer items-center gap-1.5 text-[var(--ops-muted)]">
              <input
                type="checkbox"
                checked={showOff}
                onChange={(e) => setShowOff(e.target.checked)}
              />
              Show the {offCount} cancelled and moved
            </label>
          )}
          <button type="button" className="ops-btn" onClick={() => setPanel({ kind: "add" })}>
            <Icon name="calendar" size={13} /> Add a session
          </button>
        </span>
      </div>

      {/* Appears only when something is chosen. A toolbar of disabled buttons
          is furniture on a page staff read every morning. */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--ops-line)] bg-[var(--ops-tint)] px-4 py-3">
          <strong>
            {selected.size} {selected.size === 1 ? "date" : "dates"} chosen
          </strong>
          <button
            type="button"
            className="ops-btn ops-btn-primary"
            onClick={() => setPanel({ kind: "cancel" })}
            disabled={movable.length === 0}
          >
            Cancel {movable.length === 1 ? "it" : "them"}
          </button>
          <button
            type="button"
            className="ops-btn"
            onClick={() => setPanel({ kind: "shift" })}
            disabled={movable.length === 0}
          >
            Move {movable.length === 1 ? "it" : "them all"} by a number of days
          </button>
          {enrolled > 0 && (
            <span className="ml-auto text-[var(--ops-muted)]">
              {enrolled} {enrolled === 1 ? "family is" : "families are"} in this class
            </span>
          )}
        </div>
      )}

      {/* ----------------------------------------------------------- table */}
      <div className="overflow-x-auto">
        <table className="ops-table">
          <thead>
            <tr>
              <th className="w-9">
                <span className="sr-only">Choose</span>
              </th>
              <th className="ops-num w-10">#</th>
              <th>Date</th>
              <th>Status</th>
              <th>Reason</th>
              <th>Note to parents</th>
              <th className="w-28">Change it</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((s) => (
              // data-session is a deliberate hook. A test that finds a row by
              // counting "the third tr containing the word scheduled" breaks
              // the first time a row's wording changes, and then somebody
              // weakens the assertion to make it pass again.
              <tr key={s.id} data-session={s.id} data-chosen={selected.has(s.id) || undefined}>
                <td>
                  <input
                    type="checkbox"
                    checked={selected.has(s.id)}
                    onChange={() => toggle(s.id)}
                    disabled={s.status === "rescheduled"}
                    aria-label={`Choose ${s.label}`}
                  />
                </td>
                <td className="ops-num text-[var(--ops-faint)]">{s.seq}</td>
                <td className={s.status === "scheduled" ? "" : "line-through opacity-60"}>
                  <span className="whitespace-nowrap">{s.label}</span>
                  <span className="ops-mono ml-2 whitespace-nowrap">{s.time}</span>
                </td>
                <td>
                  <span className="flex flex-wrap gap-1.5">
                    {s.status === "scheduled" && (
                      <Pill tone={s.past ? "quiet" : "good"}>
                        {s.past ? "done" : "scheduled"}
                      </Pill>
                    )}
                    {s.status === "cancelled" && <Pill tone="danger">cancelled</Pill>}
                    {s.status === "rescheduled" && <Pill tone="quiet">moved</Pill>}
                    {s.isReplacement && <Pill tone="info">replacement</Pill>}
                    {s.manual && s.status === "scheduled" && !s.isReplacement && (
                      <Pill tone="info">extra</Pill>
                    )}
                  </span>
                </td>
                <td className="text-[var(--ops-muted)]">
                  {s.reasonLabel ?? "—"}
                  {s.changedBy && <span className="ops-mono block">{s.changedBy}</span>}
                </td>
                {/* Clamped, with the whole thing on the title. One chatty note
                    must not be able to stretch every other row. */}
                <td className="text-[var(--ops-muted)]">
                  {s.note ? (
                    <span className="ops-clamp" title={s.note}>
                      {s.note}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  {s.status === "scheduled" && !s.past && (
                    <button
                      type="button"
                      className="ops-btn"
                      onClick={() => setPanel({ kind: "move", session: s })}
                    >
                      Move
                    </button>
                  )}
                  {s.status === "cancelled" && (
                    <button
                      type="button"
                      className="ops-btn"
                      onClick={() => setPanel({ kind: "restore", session: s })}
                    >
                      <Icon name="undo" size={13} /> Put it back
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {visible.length === 0 && (
        <p className="px-4 py-6 text-[var(--ops-muted)]">
          Nothing to show.{offCount > 0 && " Every date is cancelled or moved."}
        </p>
      )}

      {/* --------------------------------------------------------- dialogs */}
      {panel.kind === "cancel" && (
        <CancelDialog sessions={movable} onClose={close} onDone={finished} />
      )}
      {panel.kind === "shift" && (
        <ShiftDialog sessions={movable} onClose={close} onDone={finished} />
      )}
      {panel.kind === "move" && (
        <MoveDialog
          session={panel.session}
          defaultStart={defaultStart}
          defaultEnd={defaultEnd}
          onClose={close}
          onDone={finished}
        />
      )}
      {panel.kind === "restore" && (
        <RestoreDialog session={panel.session} onClose={close} onDone={finished} />
      )}
      {panel.kind === "add" && (
        <AddDialog
          classOfferingId={classOfferingId}
          defaultStart={defaultStart}
          defaultEnd={defaultEnd}
          onClose={close}
          onDone={finished}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The dialogs. Each is a form around a server action, and each reports what
// happened in a sentence rather than by silently refreshing.
// ---------------------------------------------------------------------------

function Result({ state }: { state: ScheduleState }) {
  if (!state) return null;
  return (
    <p
      role="status"
      aria-live="polite"
      className={`ops-note mt-3 ${state.ok ? "ops-note-good" : "ops-note-bad"}`}
    >
      {state.message}
    </p>
  );
}

/**
 * Close once the change has landed and been read.
 *
 * Not instantly: the message is the only place the count of families emailed
 * appears, and a dialog that vanishes the moment it succeeds means nobody ever
 * sees it. Long enough to read one sentence, then out of the way.
 */
function useCloseOnSuccess(state: ScheduleState, onDone: () => void) {
  useEffect(() => {
    if (!state?.ok) return;
    const timer = setTimeout(onDone, 1600);
    return () => clearTimeout(timer);
  }, [state, onDone]);
}

function ReasonField({ id }: { id: string }) {
  return (
    <div>
      <label htmlFor={`reason-${id}`} className="ops-label">
        Why
      </label>
      <select
        id={`reason-${id}`}
        name="reasonCode"
        className="ops-field w-full"
        required
        defaultValue=""
      >
        <option value="" disabled>
          Choose a reason
        </option>
        {CANCEL_REASONS.map((r) => (
          <option key={r.code} value={r.code}>
            {r.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function NoteField({ id, placeholder }: { id: string; placeholder: string }) {
  return (
    <div>
      <label htmlFor={`note-${id}`} className="ops-label">
        What should parents be told?
      </label>
      <textarea
        id={`note-${id}`}
        name="note"
        className="ops-field ops-field-area w-full"
        maxLength={500}
        rows={2}
        placeholder={placeholder}
      />
    </div>
  );
}

function NotifyField({ id, hint }: { id: string; hint: string }) {
  return (
    <label htmlFor={`notify-${id}`} className="flex items-start gap-2">
      <input id={`notify-${id}`} name="notify" type="checkbox" defaultChecked className="mt-0.5" />
      <span>
        Email the families
        <span className="block text-[var(--ops-muted)]">{hint}</span>
      </span>
    </label>
  );
}

function Actions({
  pending,
  done,
  label,
  busyLabel,
  onClose,
}: {
  pending: boolean;
  done: boolean;
  label: string;
  busyLabel: string;
  onClose: () => void;
}) {
  return (
    <div className="mt-4 flex justify-end gap-2">
      <button type="button" className="ops-btn" onClick={onClose} disabled={pending}>
        {done ? "Close" : "Never mind"}
      </button>
      {/* Disabled once it has succeeded, so a second click cannot re-run a
          change that has already happened. */}
      <button className="ops-btn ops-btn-primary" disabled={pending || done}>
        {pending ? busyLabel : label}
      </button>
    </div>
  );
}

function dateSummary(sessions: EditorSession[]) {
  if (sessions.length === 0) return "";
  if (sessions.length <= 4) return sessions.map((s) => s.label).join(", ");
  return `${sessions[0].label} through ${sessions[sessions.length - 1].label}, ${sessions.length} dates`;
}

function CancelDialog({
  sessions,
  onClose,
  onDone,
}: {
  sessions: EditorSession[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(cancelSessionsAction, null);
  useCloseOnSuccess(state, onDone);

  return (
    <Modal
      title={`Cancel ${sessions.length} ${sessions.length === 1 ? "date" : "dates"}`}
      description={dateSummary(sessions)}
      onClose={onClose}
      tone="ops"
    >
      <form action={action}>
        <input type="hidden" name="sessionIds" value={sessions.map((s) => s.id).join(",")} />
        <p className="text-[var(--ops-muted)]">
          Everyone keeps their place. Only these dates stop.
        </p>

        <div className="mt-3 space-y-3">
          <ReasonField id="cancel" />
          <NoteField id="cancel" placeholder="Instructor out sick" />
          <NotifyField id="cancel" hint="One message covering all the dates chosen." />
        </div>

        <Actions
          pending={pending}
          done={Boolean(state?.ok)}
          label="Cancel these dates"
          busyLabel="Cancelling"
          onClose={onClose}
        />
        <Result state={state} />
      </form>
    </Modal>
  );
}

function ShiftDialog({
  sessions,
  onClose,
  onDone,
}: {
  sessions: EditorSession[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(shiftSessionsAction, null);
  const [days, setDays] = useState(7);
  useCloseOnSuccess(state, onDone);

  return (
    <Modal
      title={`Move ${sessions.length} ${sessions.length === 1 ? "date" : "dates"}`}
      description={dateSummary(sessions)}
      onClose={onClose}
      tone="ops"
    >
      <form action={action}>
        <input type="hidden" name="sessionIds" value={sessions.map((s) => s.id).join(",")} />
        <p className="text-[var(--ops-muted)]">
          Every chosen date moves by the same number of days and keeps its time. A
          date left behind is recorded as a closure, so regenerating the schedule
          will not quietly fill it back in.
        </p>

        <div className="mt-3 space-y-3">
          <div>
            <label htmlFor="byDays" className="ops-label">
              Move by
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id="byDays"
                name="byDays"
                type="number"
                className="ops-field w-24"
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                step={1}
                min={-365}
                max={365}
                required
              />
              <span className="text-[var(--ops-muted)]">
                days {days > 0 ? "later" : days < 0 ? "earlier" : ""}
              </span>
              <span className="ml-auto flex gap-1">
                {[-7, 7, 14].map((d) => (
                  <button key={d} type="button" className="ops-btn" onClick={() => setDays(d)}>
                    {d > 0 ? `+${d}` : d}
                  </button>
                ))}
              </span>
            </div>
          </div>
          <ReasonField id="shift" />
          <NoteField id="shift" placeholder="Term starts a week late" />
          <NotifyField id="shift" hint="One message about the whole change, not one per date." />
        </div>

        <Actions
          pending={pending}
          done={Boolean(state?.ok)}
          label="Move them"
          busyLabel="Moving"
          onClose={onClose}
        />
        <Result state={state} />
      </form>
    </Modal>
  );
}

function MoveDialog({
  session,
  defaultStart,
  defaultEnd,
  onClose,
  onDone,
}: {
  session: EditorSession;
  defaultStart: string;
  defaultEnd: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(moveSessionAction, null);
  const [retime, setRetime] = useState(false);
  useCloseOnSuccess(state, onDone);

  return (
    <Modal
      title={`Move ${session.label}`}
      description="The old date stays on the calendar, struck through and pointing at the new one, so a family can see what happened."
      onClose={onClose}
      tone="ops"
    >
      <form action={action}>
        <input type="hidden" name="sessionId" value={session.id} />

        <div className="space-y-3">
          <div>
            <label htmlFor="newDate" className="ops-label">
              New date
            </label>
            <input
              id="newDate"
              name="newDate"
              type="date"
              className="ops-field w-full"
              defaultValue={session.date}
              required
            />
          </div>
          <ReasonField id="move" />
          <NoteField id="move" placeholder="The hall is booked that afternoon" />

          <label className="flex items-center gap-2">
            <input type="checkbox" checked={retime} onChange={(e) => setRetime(e.target.checked)} />
            Change the time as well
          </label>

          {retime && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="startTime" className="ops-label">
                  Starts
                </label>
                <input
                  id="startTime"
                  name="startTime"
                  type="time"
                  className="ops-field w-full"
                  defaultValue={defaultStart}
                  required
                />
              </div>
              <div>
                <label htmlFor="endTime" className="ops-label">
                  Ends
                </label>
                <input
                  id="endTime"
                  name="endTime"
                  type="time"
                  className="ops-field w-full"
                  defaultValue={defaultEnd}
                  required
                />
              </div>
            </div>
          )}

          <NotifyField id="move" hint="Tells them the old date and the new one." />
        </div>

        <Actions
          pending={pending}
          done={Boolean(state?.ok)}
          label="Move it"
          busyLabel="Moving"
          onClose={onClose}
        />
        <Result state={state} />
      </form>
    </Modal>
  );
}

function AddDialog({
  classOfferingId,
  defaultStart,
  defaultEnd,
  onClose,
  onDone,
}: {
  classOfferingId: string;
  defaultStart: string;
  defaultEnd: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(addSessionAction, null);
  useCloseOnSuccess(state, onDone);

  return (
    <Modal
      title="Add a session"
      description="A make up class, usually. It does not have to be on the class's usual weekday, and editing the term's dates later will not remove it."
      onClose={onClose}
      tone="ops"
    >
      <form action={action}>
        <input type="hidden" name="classOfferingId" value={classOfferingId} />

        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="add-date" className="ops-label">
                Date
              </label>
              <input
                id="add-date"
                name="date"
                type="date"
                className="ops-field w-full"
                required
              />
            </div>
            <div>
              <label htmlFor="add-start" className="ops-label">
                Starts
              </label>
              <input
                id="add-start"
                name="startTime"
                type="time"
                className="ops-field w-full"
                defaultValue={defaultStart}
                required
              />
            </div>
            <div>
              <label htmlFor="add-end" className="ops-label">
                Ends
              </label>
              <input
                id="add-end"
                name="endTime"
                type="time"
                className="ops-field w-full"
                defaultValue={defaultEnd}
                required
              />
            </div>
          </div>
          <NoteField id="add" placeholder="Make up for the storm week" />
          <NotifyField id="add" hint="Tells them there is an extra class and nothing to pay." />
        </div>

        <Actions
          pending={pending}
          done={Boolean(state?.ok)}
          label="Add it"
          busyLabel="Adding"
          onClose={onClose}
        />
        <Result state={state} />
      </form>
    </Modal>
  );
}

/**
 * Put a cancelled date back.
 *
 * There was no way to do this at all, so one misclick was permanent and the
 * only fix was a developer at a psql prompt. Deliberately a confirmation rather
 * than a single click, because restoring a date emails everybody who was told
 * it was off.
 */
function RestoreDialog({
  session,
  onClose,
  onDone,
}: {
  session: EditorSession;
  onClose: () => void;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(restoreSessionAction, null);
  useCloseOnSuccess(state, onDone);

  return (
    <Modal title={`Run ${session.label} after all?`} onClose={onClose} width={480} tone="ops">
      <form action={action}>
        <input type="hidden" name="sessionId" value={session.id} />

        <p className="text-[var(--ops-muted)]">
          It is currently cancelled
          {session.reasonLabel ? `: ${session.reasonLabel.toLowerCase()}` : ""}.
          {session.fromBlackout &&
            " Putting it back also removes it from this class's holidays, otherwise regenerating the schedule would cancel it again."}
        </p>

        <div className="mt-3 space-y-3">
          <NoteField id="restore" placeholder="Sorry for the change about" />
          <NotifyField id="restore" hint="Tells them the class is running after all." />
        </div>

        <Actions
          pending={pending}
          done={Boolean(state?.ok)}
          label="Yes, run it"
          busyLabel="Restoring"
          onClose={onClose}
        />
        <Result state={state} />
      </form>
    </Modal>
  );
}
