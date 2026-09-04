import { redirect } from "next/navigation";
import { currentStaff } from "@/lib/staff-auth";
import { schools } from "../queries";
import { SchoolsTable } from "./table";
import { PageHead } from "../../ui";

export const dynamic = "force-dynamic";

export default async function SchoolsPage() {
  if (!(await currentStaff())) redirect("/admin/login");
  const rows = await schools();
  const listed = rows.filter((r) => r.active).length;

  return (
    <>
      <PageHead
        title="Campuses"
        note={`${rows.length} on file, ${listed} listed to families. A campus with no classes this term still belongs here; it just does not appear on the site.`}
      />
      <div className="mt-4">
        <SchoolsTable rows={rows} />
      </div>
    </>
  );
}
