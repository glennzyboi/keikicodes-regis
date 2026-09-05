import { notFound } from "next/navigation";
import { isUuid } from "@keiki/core/uuid";
import { readAsStaff, sessionRows, enrollmentRows } from "@/app/admin/queries";
import { ScheduleEditor } from "@/app/admin/schedule-editor";
import { toEditorSessions } from "@/app/admin/to-editor-sessions";

export const dynamic = "force-dynamic";

/**
 * The term, under the office's hands.
 *
 * Unchanged from where it was, only moved: this is the best control in the
 * console and nothing about it needed revisiting. What did need revisiting is
 * where it lives. There used to be a second, worse copy of it on the class list,
 * two buttons reading "Cancel it" and "Move it" that acted only on whichever
 * date happened to be next. Somebody testing the console found them confusing,
 * which is fair: they looked like the way to change a schedule, and they could
 * not express a single thing an office actually rings up about. They are gone.
 * This is the one way to change a schedule, and it can act on any date, several
 * dates, or the whole term.
 */
export default async function Schedule({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const { data } = await readAsStaff(async (tx) => ({
    sessions: await sessionRows(tx, { classOfferingId: id }),
    roster: await enrollmentRows(tx, { classOfferingId: id }),
  }));

  const active = data.roster.filter((r) => r.status !== "cancelled");
  const upcoming = data.sessions.filter(
    (s) => s.status === "scheduled" && new Date(s.starts_at) >= new Date(),
  );

  // Shaped for the editor on the server, so the client component receives a
  // list it can render rather than a pile of Dates and codes it has to format.
  // The reason labels in particular have to come from the shared list, not from
  // a second copy that will drift the first time a code is added.
  const editorSessions = toEditorSessions(data.sessions);

  return (
    <section className="ops-panel ops-enter">
      <div className="ops-panel-head">
        <div>
          <h2 className="text-[15px] font-semibold">
            Schedule
            <span className="ops-pill ops-pill-quiet ml-2 align-middle">
              {upcoming.length} left
            </span>
          </h2>
          <p className="mt-0.5 max-w-3xl text-[var(--ops-muted)]">
            Tick dates, then say what happens to them. Every change records a reason and
            emails the families in the same transaction, so a change that rolls back
            cannot leave anybody told about it.
          </p>
        </div>
      </div>

      <ScheduleEditor
        classOfferingId={id}
        enrolled={active.length}
        defaultStart={editorSessions.defaultStart}
        defaultEnd={editorSessions.defaultEnd}
        sessions={editorSessions.rows}
      />
    </section>
  );
}
