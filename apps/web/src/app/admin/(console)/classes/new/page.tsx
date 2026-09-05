import { pickers } from "@/app/admin/catalogue-queries";
import { OfferingForm } from "@/app/admin/offering-form";
import { PageHead } from "@/app/admin/ui";

export const dynamic = "force-dynamic";

export default async function NewClassPage() {
  const p = await pickers();

  if (p.schools.length === 0 || p.programs.length === 0 || p.terms.length === 0) {
    return (
      <PageHead
        title="Nothing to build a class from yet"
        note="A class needs a campus, a program and a term. Add those first."
      />
    );
  }

  return (
    <>
      <PageHead
        title="New class"
        note="A program, at a campus, in a term. The dates on the right update as you type, so you can see the schedule before you commit to it."
      />
      <div className="mt-4">
        <OfferingForm offering={null} pickers={p} enrolled={0} existingSessions={[]} />
      </div>
    </>
  );
}
