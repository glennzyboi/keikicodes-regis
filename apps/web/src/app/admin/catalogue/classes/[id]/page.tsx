import { notFound, redirect } from "next/navigation";
import { isUuid } from "@keiki/core/uuid";
import { currentStaff } from "@/lib/staff-auth";
import { offering, pickers, sessionsOf, enrolledCount } from "../../queries";
import { OfferingForm } from "../offering-form";
import { PageHead, Pill } from "../../../ui";

export const dynamic = "force-dynamic";

export default async function EditClassPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await currentStaff())) redirect("/admin/login");
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [row, p, sessions, enrolled] = await Promise.all([
    offering(id),
    pickers(),
    sessionsOf(id),
    enrolledCount(id),
  ]);
  if (!row) notFound();

  return (
    <>
      <PageHead
        title={row.title}
        note={`${row.school} · ${row.term} · ${row.sessionCount} sessions · ${enrolled} registered`}
        actions={
          <div className="flex items-center gap-2">
            <Pill tone={row.status === "published" ? "good" : row.status === "draft" ? "warn" : "quiet"}>
              {row.status}
            </Pill>
            <a
              className="ops-btn"
              href={`/admin/classes/${row.id}`}
            >
              Roster and money
            </a>
          </div>
        }
      />
      <div className="mt-4">
        <OfferingForm
          offering={row}
          pickers={p}
          enrolled={enrolled}
          existingSessions={sessions}
        />
      </div>
    </>
  );
}
