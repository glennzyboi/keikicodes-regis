import Link from "next/link";
import { readAsStaff, childRows } from "../queries";
import { EmptyState, Icon, PageHead, Pill, PageSearch } from "../ui";

export const dynamic = "force-dynamic";

/**
 * Every child, across every family.
 *
 * A separate view from Families because the question is genuinely different.
 * Families answers "who is calling"; Students answers "which Kaimana", which is
 * the one you need when a name is shouted across the office and three of them
 * are enrolled this term.
 */
export default async function Students({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const { data: students } = await readAsStaff((tx) => childRows(tx, { search: q }));

  return (
    <div className="space-y-4">
      <PageHead
        title="Students"
        note="Every child on file, with the family they belong to. Medical notes are shown here because the office needs them before a class starts, not after."
      />

      <PageSearch action="/admin/students" q={q} placeholder="Kaimana, Kealoha" />

      <section className="ops-panel ops-enter">
        <div className="ops-panel-head">
          <h2 className="text-[15px] font-semibold">
            {q ? `Matching "${q}"` : "All students"}
            <span className="ops-pill ops-pill-quiet ml-2 align-middle">{students.length}</span>
          </h2>
        </div>

        {students.length === 0 ? (
          <EmptyState
            icon="child"
            title={q ? "No student matches that" : "No students yet"}
            note="Children appear here as soon as a family registers one."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="ops-table">
              <thead>
                <tr>
                  <th>Child</th>
                  <th>Born</th>
                  <th>Family</th>
                  <th className="ops-num">Classes</th>
                  <th>Notes we hold</th>
                </tr>
              </thead>
              <tbody>
                {students.map((c) => (
                  <tr key={c.child_id}>
                    <td className="font-medium">
                      {c.first_name} {c.last_name}
                    </td>
                    <td className="text-[var(--ops-muted)]">{c.date_of_birth}</td>
                    <td>
                      <Link
                        href={`/admin/families/${c.parent_id}`}
                        className="underline decoration-dotted underline-offset-2"
                      >
                        {c.parent_name}
                      </Link>
                      <p className="ops-mono">{c.parent_email}</p>
                    </td>
                    <td className="ops-num">{c.enrollments}</td>
                    <td>
                      {c.notes ? (
                        <span className="ops-pill ops-pill-warn">
                          <Icon name="warning" size={11} />
                          {c.notes}
                        </span>
                      ) : (
                        <Pill tone="quiet">none</Pill>
                      )}
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
