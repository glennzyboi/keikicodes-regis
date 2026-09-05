import Link from "next/link";
import { notFound } from "next/navigation";
import { formatMoney } from "@keiki/core/money";
import { isUuid } from "@keiki/core/uuid";
import { signPhotos } from "@/lib/photos";
import { ChildPhoto } from "@/app/admin/child-photo";
import { readAsStaff, enrollmentRows, classRows, sessionRows } from "@/app/admin/queries";
import { EmptyState, Pill } from "@/app/admin/ui";
import { TransferChild } from "../transfer";
import { DropChild } from "@/app/admin/drop-child";

export const dynamic = "force-dynamic";

/**
 * Who is in the room.
 *
 * This was a section halfway down a very long class page; it is a tab now, so
 * it can be printed, linked and read on a phone on the way to a session without
 * scrolling past the calendar to reach it.
 *
 * The photographs are signed once for the whole roster rather than per row.
 * Eighteen children would otherwise be eighteen round trips to storage before
 * the page could render.
 */
export default async function Roster({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const { data } = await readAsStaff(async (tx) => ({
    roster: await enrollmentRows(tx, { classOfferingId: id }),
    others: await classRows(tx),
    sessions: await sessionRows(tx, { classOfferingId: id }),
  }));

  // Only what is still to come. "Which week did they stop" is always a future
  // date at the moment somebody records it.
  const upcoming = data.sessions
    .filter((s) => s.status === "scheduled" && new Date(s.starts_at) >= new Date())
    .map((s) => ({
      id: s.session_id,
      label: new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        timeZone: s.timezone,
      }).format(new Date(s.starts_at)),
    }));

  const photos = await signPhotos(data.roster.map((r) => r.photo_path));
  // A dropped place is not in the room either, so it does not count toward the
  // roster total. Every seat query elsewhere already says the same thing:
  // status in (active, cancellation_requested).
  const active = data.roster.filter(
    (r) => r.status !== "cancelled" && r.status !== "dropped",
  );

  return (
    <section className="ops-panel ops-enter">
      <div className="ops-panel-head">
        <div>
          <h2 className="text-[15px] font-semibold">
            Roster
            <span className="ops-pill ops-pill-quiet ml-2 align-middle">{active.length}</span>
          </h2>
          <p className="mt-0.5 text-[var(--ops-muted)]">
            Who is in the room, who joined after the start, and who goes back to after
            school care at the end
          </p>
        </div>
      </div>

      {data.roster.length === 0 ? (
        <EmptyState
          icon="users"
          title="Nobody enrolled yet"
          note="Registrations will appear here as families pay."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="ops-table">
            <thead>
              <tr>
                <th>Child</th>
                <th>Grade</th>
                <th>Family</th>
                <th className="ops-num">Paid</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.roster.map((r) => (
                <tr key={r.enrollment_id}>
                  <td>
                    <span className="flex items-center gap-2.5">
                      <ChildPhoto
                        name={r.child_name}
                        url={r.photo_path ? photos.get(r.photo_path) : null}
                      />
                      <span>
                        <Link
                          href={`/admin/students/${r.child_id}`}
                          className="font-medium underline decoration-transparent underline-offset-2 hover:decoration-inherit"
                        >
                          {r.child_name}
                        </Link>
                        {r.in_afterschool_care && (
                          // Decides where the child is handed back at the end of
                          // a session, so it belongs on the roster rather than
                          // three clicks away.
                          <span className="ops-pill ops-pill-info ml-2">
                            {r.afterschool_care_program ?? "after school care"}
                          </span>
                        )}
                        {r.notes && (
                          <span className="ops-pill ops-pill-warn ml-2" title={r.notes}>
                            note
                          </span>
                        )}
                      </span>
                    </span>
                  </td>
                  <td>{r.grade === null ? "" : r.grade === 0 ? "K" : `Grade ${r.grade}`}</td>
                  <td>
                    <Link
                      href={`/admin/families/${r.parent_id}`}
                      className="underline decoration-dotted underline-offset-2"
                    >
                      {r.parent_name}
                    </Link>
                    <p className="ops-mono">{r.parent_email}</p>
                  </td>
                  <td className="ops-num">{formatMoney(r.price_cents)}</td>
                  <td>
                    <div className="flex flex-wrap gap-1.5">
                      {r.status === "active" && <Pill tone="good">enrolled</Pill>}
                      {r.status === "cancellation_requested" && (
                        <Pill tone="warn">cancellation asked</Pill>
                      )}
                      {r.status === "cancelled" && <Pill tone="quiet">cancelled</Pill>}
                      {r.status === "dropped" && <Pill tone="warn">dropped</Pill>}
                      {r.joined_late && <Pill tone="info">joined mid term</Pill>}
                    </div>
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1.5">
                    {r.status !== "cancelled" && r.status !== "dropped" && (
                      <DropChild
                        enrollmentId={r.enrollment_id}
                        childName={r.child_name}
                        sessions={upcoming}
                      />
                    )}
                    {r.status !== "cancelled" && r.status !== "dropped" && (
                      <TransferChild
                        enrollmentId={r.enrollment_id}
                        childName={r.child_name}
                        currentClassId={id}
                        classes={data.others.map((o) => ({
                          id: o.id,
                          title: o.title,
                          school: o.school,
                          free: o.capacity - o.seats_taken,
                        }))}
                      />
                    )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
