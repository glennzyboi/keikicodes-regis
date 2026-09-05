"use server";

import { revalidatePath, updateTag } from "next/cache";
import { CATALOGUE_TAG } from "@/lib/catalogue-cache";
import { redirect } from "next/navigation";
import { currentStaff } from "@/lib/staff-auth";
import { asUser } from "@keiki/core/rls";
import {
  addSession,
  cancelSessions,
  moveSession,
  restoreSession,
  shiftSessions,
} from "@keiki/core/schedule";
import {
  parseForm,
  AddSessionForm,
  CancelSessionForm,
  RescheduleSessionForm,
  RestoreSessionForm,
  ShiftSessionsForm,
} from "@keiki/core/forms";

/**
 * The schedule editor's server actions.
 *
 * Each one is a public HTTP endpoint that happens to have a form in front of
 * it, so each one re-checks the session, re-parses the input against a schema,
 * and runs the domain function inside `asUser`, which means row level security
 * decides what this person can touch rather than a hopeful WHERE clause.
 *
 * They return a message instead of throwing. A staff member who picked a date
 * that already has a class needs to read that sentence, not an error boundary,
 * and the refusals are the interesting part of this feature.
 */

export type ScheduleState = {
  ok: boolean;
  message: string;
  /** Makes two identical results distinguishable so the UI re-announces. */
  at: number;
} | null;

const ok = (message: string): ScheduleState => ({ ok: true, message, at: Date.now() });
const no = (message: string): ScheduleState => ({ ok: false, message, at: Date.now() });

/** "3 dates" or "1 date", because "1 dates" reads as a bug. */
function count(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function told(n: number) {
  return n === 0 ? "Nobody needed telling." : `${count(n, "family", "families")} emailed.`;
}

function refresh() {
  revalidatePath("/admin/classes", "layout");
  revalidatePath("/admin/setup", "layout");
  revalidatePath("/admin/schedule");
  revalidatePath("/admin");
  revalidatePath("/dashboard");

  // The public catalogue is cached, and a class card shows how many sessions
  // will actually run. Cancelling a date changes that number, so the cache has
  // to go with it. updateTag rather than revalidateTag: the person who just
  // pressed the button must see their own change, not a stale copy served while
  // a background refresh runs.
  updateTag(CATALOGUE_TAG);
}

export async function cancelSessionsAction(
  _prev: ScheduleState,
  formData: FormData,
): Promise<ScheduleState> {
  const staff = await currentStaff();
  if (!staff) redirect("/admin/login");

  const parsed = parseForm(CancelSessionForm, formData);
  if (!parsed.ok) return no(parsed.error);
  const { sessionIds, reasonCode, note, notify } = parsed.data;

  const result = await asUser(staff.authUserId, (tx) =>
    cancelSessions(tx, { sessionIds, reasonCode, note, notify, actorId: staff.id }),
  );

  if (!result.ok) return no(result.detail);
  refresh();

  const skipped =
    result.skipped > 0 ? ` ${count(result.skipped, "date")} was already off, so left alone.` : "";
  return ok(
    `${count(result.cancelled, "date")} cancelled. ${notify ? told(result.notified) : "No email sent."}${skipped}`,
  );
}

export async function restoreSessionAction(
  _prev: ScheduleState,
  formData: FormData,
): Promise<ScheduleState> {
  const staff = await currentStaff();
  if (!staff) redirect("/admin/login");

  const parsed = parseForm(RestoreSessionForm, formData);
  if (!parsed.ok) return no(parsed.error);
  const { sessionId, note, notify } = parsed.data;

  const result = await asUser(staff.authUserId, (tx) =>
    restoreSession(tx, { sessionId, note, notify, actorId: staff.id }),
  );

  if (!result.ok) return no(result.detail);
  refresh();

  // Worth saying out loud. Restoring a holiday changes the class's own blackout
  // list, so the next regeneration will not quietly cancel it again.
  const blackout = result.blackoutRemoved
    ? " The holiday was removed from this class as well, so it stays on."
    : "";
  return ok(`That date is running again. ${notify ? told(result.notified) : "No email sent."}${blackout}`);
}

export async function moveSessionAction(
  _prev: ScheduleState,
  formData: FormData,
): Promise<ScheduleState> {
  const staff = await currentStaff();
  if (!staff) redirect("/admin/login");

  const parsed = parseForm(RescheduleSessionForm, formData);
  if (!parsed.ok) return no(parsed.error);
  const { sessionId, newDate, startTime, endTime, reasonCode, note, notify } = parsed.data;

  const result = await asUser(staff.authUserId, (tx) =>
    moveSession(tx, {
      sessionId,
      newDate,
      startTime,
      endTime,
      reasonCode,
      note,
      notify,
      actorId: staff.id,
    }),
  );

  if (!result.ok) return no(result.detail);
  refresh();
  return ok(
    `Moved to ${newDate}${startTime ? `, ${startTime} to ${endTime}` : ""}. ${
      notify ? told(result.notified) : "No email sent."
    }`,
  );
}

export async function shiftSessionsAction(
  _prev: ScheduleState,
  formData: FormData,
): Promise<ScheduleState> {
  const staff = await currentStaff();
  if (!staff) redirect("/admin/login");

  const parsed = parseForm(ShiftSessionsForm, formData);
  if (!parsed.ok) return no(parsed.error);
  const { sessionIds, byDays, reasonCode, note, notify } = parsed.data;

  const result = await asUser(staff.authUserId, (tx) =>
    shiftSessions(tx, { sessionIds, byDays, reasonCode, note, notify, actorId: staff.id }),
  );

  if (!result.ok) return no(result.detail);
  refresh();

  const dir = byDays > 0 ? "later" : "earlier";
  return ok(
    `${count(result.moved, "date")} moved ${count(Math.abs(byDays), "day")} ${dir}. ${
      notify ? told(result.notified) : "No email sent."
    }`,
  );
}

export async function addSessionAction(
  _prev: ScheduleState,
  formData: FormData,
): Promise<ScheduleState> {
  const staff = await currentStaff();
  if (!staff) redirect("/admin/login");

  const parsed = parseForm(AddSessionForm, formData);
  if (!parsed.ok) return no(parsed.error);
  const { classOfferingId, date, startTime, endTime, note, notify } = parsed.data;

  const result = await asUser(staff.authUserId, (tx) =>
    addSession(tx, { classOfferingId, date, startTime, endTime, note, notify, actorId: staff.id }),
  );

  if (!result.ok) return no(result.detail);
  refresh();
  return ok(`Extra session added on ${date}. ${notify ? told(result.notified) : "No email sent."}`);
}
