import { redirect } from "next/navigation";
import { currentStaff } from "@/lib/staff-auth";
import { sql } from "@keiki/core/db";
import { ImportPanel } from "./panel";
import { PageHead } from "../../ui";

export const dynamic = "force-dynamic";

/**
 * Pull the catalogue across from the system they run today.
 *
 * The point of this page is that the migration is not a big bang. Their
 * Airtable stays the source of truth for as long as they want it to be, this
 * reads from it, and the day they decide to switch, the only change is which
 * URL their website calls.
 *
 * It reads. It never writes to their Airtable. Two systems that both believe
 * they own the same record is how a migration of this shape dies, and the
 * answer is a direction and a date rather than something clever.
 */
export default async function ImportPage() {
  if (!(await currentStaff())) redirect("/admin/login");

  const [counts] = await sql<
    { schools: number; programs: number; offerings: number; sessions: number }[]
  >`select (select count(*) from schools)::int          as schools,
           (select count(*) from programs)::int         as programs,
           (select count(*) from class_offerings)::int  as offerings,
           (select count(*) from sessions
             where status = 'scheduled')::int           as sessions`;

  return (
    <>
      <PageHead
        title="Import from Airtable"
        note="Reads the two n8n endpoints your website already calls, and updates the catalogue here to match. It only ever reads from them."
      />
      <div className="mt-4">
        <ImportPanel counts={counts} />
      </div>
    </>
  );
}
