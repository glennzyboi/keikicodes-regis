import Link from "next/link";
import { notFound } from "next/navigation";
import { isUuid } from "@keiki/core/uuid";
import { formatMoney } from "@keiki/core/stripe";
import { signPhotos } from "@/lib/photos";
import { readAsStaff, childRows, enrollmentRows } from "@/app/admin/queries";
import { ChildPhoto } from "@/app/admin/child-photo";
import { EmptyState, Pill, ageFrom, when } from "@/app/admin/ui";

export const dynamic = "force-dynamic";

/**
 * One child.
 *
 * This route did not exist, so every student row on the list had nowhere to go
 * and the name was not a link. The office question it answers is a real one and
 * a different one from the family page: "who is this child, what are they in,
 * and is there anything I need to know before they walk into a room".
 *
 * Composed from queries that already exist rather than new ones. A child is not
 * a new concept in this schema; it just never had a page.
 */
export default async function StudentDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const { data } = await readAsStaff(async (tx) => ({
    // childRows already carries the family, the notes, the care flag and the
    // photo path. Filtering here rather than adding a childById keeps one query
    // to maintain instead of two that can disagree.
    child: (await childRows(tx, { perPage: 500 })).find((c) => c.child_id === id),
    enrollments: await enrollmentRows(tx, {}),
  }));

  const child = data.child;
  if (!child) notFound();

  const mine = data.enrollments.filter((e) => e.child_id === id);
  const live = mine.filter((e) => e.status !== "cancelled");
  const photos = await signPhotos([child.photo_path]);
  const age = ageFrom(child.date_of_birth);

  return (
    <div className="space-y-4">
      <Link href="/admin/students" className="ops-mono inline-flex items-center gap-1">
        &larr; All students
      </Link>

      <div className="flex flex-wrap items-start gap-4">
        <ChildPhoto
          name={`${child.first_name} ${child.last_name}`}
          url={child.photo_path ? photos.get(child.photo_path) : null}
          size={64}
        />
        <div className="min-w-0">
          <h1 className="text-[21px] font-semibold">
            {child.first_name} {child.last_name}
          </h1>
          <p className="mt-1 text-[var(--ops-muted)]">
            {age !== null && <>{age} years old, born </>}
            {child.date_of_birth}
            {child.grade !== null && (
              <> &middot; {child.grade === 0 ? "Kindergarten" : `Grade ${child.grade}`}</>
            )}
          </p>
          <p className="mt-1">
            <Link
              href={`/admin/families/${child.parent_id}`}
              className="underline decoration-dotted underline-offset-2"
            >
              {child.parent_name}
            </Link>
            <span className="ops-mono ml-2">{child.parent_email}</span>
          </p>
        </div>

        <div className="ml-auto flex flex-wrap gap-2">
          {child.in_afterschool_care && (
            <Pill tone="info">{child.afterschool_care_program ?? "after school care"}</Pill>
          )}
          <Pill tone={live.length > 0 ? "good" : "quiet"}>
            {live.length} {live.length === 1 ? "class" : "classes"}
          </Pill>
        </div>
      </div>

      {/* Above the fold, deliberately. An allergy is the one thing on this page
          that has to be read before a child walks into a room. */}
      {child.notes && (
        <section className="ops-panel ops-enter p-4" style={{ borderColor: "var(--ops-warn)" }}>
          <p className="ops-label">Notes we hold</p>
          <p className="mt-1 font-medium">{child.notes}</p>
        </section>
      )}

      <section className="ops-panel ops-enter">
        <div className="ops-panel-head">
          <div>
            <h2 className="text-[15px] font-semibold">
              Classes
              <span className="ops-pill ops-pill-quiet ml-2 align-middle">{mine.length}</span>
            </h2>
            <p className="mt-0.5 text-[var(--ops-muted)]">
              Everything this child has been registered for, including what was cancelled
            </p>
          </div>
        </div>

        {mine.length === 0 ? (
          <EmptyState
            icon="book"
            title="Not registered for anything"
            note="This child is on file but has no classes yet."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="ops-table">
              <thead>
                <tr>
                  <th>Class</th>
                  <th>Campus</th>
                  <th className="ops-num">Paid</th>
                  <th>Status</th>
                  <th>Registered</th>
                </tr>
              </thead>
              <tbody>
                {mine.map((e) => (
                  <tr key={e.enrollment_id}>
                    <td className="font-medium">
                      <Link
                        href={`/admin/classes/${e.class_offering_id}`}
                        className="underline decoration-dotted underline-offset-2"
                      >
                        {e.title}
                      </Link>
                    </td>
                    <td className="text-[var(--ops-muted)]">{e.school}</td>
                    <td className="ops-num">{formatMoney(e.price_cents)}</td>
                    <td>
                      <div className="flex flex-wrap gap-1.5">
                        {e.status === "active" && <Pill tone="good">enrolled</Pill>}
                        {e.status === "cancellation_requested" && (
                          <Pill tone="warn">cancellation asked</Pill>
                        )}
                        {e.status === "cancelled" && <Pill tone="quiet">cancelled</Pill>}
                        {e.joined_late && <Pill tone="info">joined mid term</Pill>}
                      </div>
                    </td>
                    <td className="text-[var(--ops-muted)]">
                      {when(new Date(e.created_at))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
