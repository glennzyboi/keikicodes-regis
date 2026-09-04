import { redirect } from "next/navigation";
import { currentStaff } from "@/lib/staff-auth";
import { terms } from "../queries";
import { TermsTable } from "./table";
import { PageHead } from "../../ui";

export const dynamic = "force-dynamic";

export default async function TermsPage() {
  if (!(await currentStaff())) redirect("/admin/login");
  const rows = await terms();
  const current = rows.find((r) => r.isCurrent);

  return (
    <>
      <PageHead
        title="Terms"
        note={
          current
            ? `${current.name} is current, so it is the one families see first. Rolling to the next term is ticking a box here, rather than editing the same string in three places in a form builder.`
            : "No term is marked current, so nothing is highlighted to families. Tick one below."
        }
      />
      <div className="mt-4">
        <TermsTable rows={rows} />
      </div>
    </>
  );
}
