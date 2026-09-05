import { notFound } from "next/navigation";
import { isUuid } from "@keiki/core/uuid";
import { offering, pickers, sessionsOf, enrolledCount } from "@/app/admin/catalogue-queries";
import { readAsStaff } from "@/app/admin/queries";
import { classHeader } from "@/app/admin/class-queries";
import { OfferingForm } from "@/app/admin/offering-form";
import { ImageField } from "@/app/admin/image-field";

export const dynamic = "force-dynamic";

/**
 * Editing the class you are already looking at.
 *
 * No page heading of its own: the layout above already says which class this is,
 * with its picture, campus, term, times and fill, and repeating that would be
 * the same four facts twice on one screen. The auth check is gone for the same
 * reason, not because it stopped mattering: the (console) layout now gates every
 * route in the section in one place, so a page cannot be added that forgets it.
 *
 * The pictures sit above the form rather than inside it because they are not
 * fields of this record. A class has no picture of its own; it shows the
 * program's, and the campus's logo beside it. Editing them here is a
 * convenience, and the labels say plainly what else it changes, because a
 * control that quietly edits five other classes is worse than no control.
 */
export default async function EditClassPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [row, p, sessions, enrolled] = await Promise.all([
    offering(id),
    pickers(),
    sessionsOf(id),
    enrolledCount(id),
  ]);
  if (!row) notFound();

  const { data: header } = await readAsStaff((tx) => classHeader(tx, id));

  return (
    <div className="space-y-4">
      {header && (
        <section className="ops-panel ops-enter">
          <div className="ops-panel-head">
            <div>
              <h2 className="text-[15px] font-semibold">Pictures families see</h2>
              <p className="mt-0.5 max-w-2xl text-[var(--ops-muted)]">
                A class shows its program&apos;s picture and its campus&apos;s logo. Neither
                belongs to this class, so changing one here changes it everywhere that
                program or campus appears.
              </p>
            </div>
          </div>
          <div className="grid gap-3 p-4 lg:grid-cols-2">
            <ImageField
              kind="program"
              id={header.program_id}
              url={header.program_image_url}
              label={header.program}
              note={`Shown on every class running this program. ${
                header.track ? `${header.track} · ` : ""
              }Used on the card a parent picks from.`}
            />
            <ImageField
              kind="campus"
              id={header.school_id}
              url={header.school_logo_url}
              label={header.school}
              note="Shown on the campus picker and on every class at this campus."
            />
          </div>
        </section>
      )}

      <OfferingForm offering={row} pickers={p} enrolled={enrolled} existingSessions={sessions} />
    </div>
  );
}
