import { redirect } from "next/navigation";
import { currentStaff } from "@/lib/staff-auth";
import { programs } from "../queries";
import { ProgramsTable } from "./table";
import { PageHead } from "../../ui";

export const dynamic = "force-dynamic";

export default async function ProgramsPage() {
  if (!(await currentStaff())) redirect("/admin/login");
  const rows = await programs();
  const reused = rows.filter((r) => r.campuses > 1).length;
  const classes = rows.reduce((n, r) => n + r.offerings, 0);

  return (
    <>
      <PageHead
        title="Programs"
        note={`${rows.length} curricula behind ${classes} classes. ${reused} run at more than one campus, which is why a program is its own record rather than a title typed onto a class.`}
      />
      <div className="mt-4">
        <ProgramsTable rows={rows} />
      </div>
    </>
  );
}
