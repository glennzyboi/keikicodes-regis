import Link from "next/link";
import { formatMoney } from "@/lib/stripe";
import { readAsStaff, familyRows } from "../queries";
import { EmptyState, Icon, PageHead, Pill, initials, tintFor, when } from "../ui";

export const dynamic = "force-dynamic";

/**
 * The list someone lands on when the phone rings.
 *
 * Search covers the parent's name, their email and their children's names,
 * because a caller says "I'm Kaimana's mum" at least as often as they give
 * their own name.
 */
export default async function Families({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const { data: families } = await readAsStaff((tx) => familyRows(tx, q));

  return (
    <div className="space-y-4">
      <PageHead
        title="Families"
        note="Everyone with an account or a registration. Search by parent name, email, or the name of a child."
      />

      <form className="flex gap-2" action="/admin/families">
        <div className="relative flex-1 max-w-md">
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="Kealoha, kaimana, parent@example.com"
            className="ops-field w-full pl-8"
            aria-label="Search families"
          />
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--ops-faint)]">
            <Icon name="search" size={14} />
          </span>
        </div>
        <button className="ops-btn">Search</button>
        {q && (
          <Link href="/admin/families" className="ops-btn">
            Clear
          </Link>
        )}
      </form>

      <section className="ops-panel ops-enter">
        <div className="ops-panel-head">
          <div>
            <h2 className="text-[15px] font-semibold">
              {q ? `Matching "${q}"` : "All families"}
              <span className="ops-pill ops-pill-quiet ml-2 align-middle">
                {families.length}
              </span>
            </h2>
            <p className="mt-0.5 text-[var(--ops-muted)]">
              Newest activity first. Open a family to see everything about them.
            </p>
          </div>
        </div>

        {families.length === 0 ? (
          <EmptyState
            icon="users"
            title={q ? "Nobody matches that" : "No families yet"}
            note={q ? "Try part of an email address, or a child's first name." : "Families appear here as soon as they create an account."}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="ops-table">
              <thead>
                <tr>
                  <th>Family</th>
                  <th>Contact</th>
                  <th className="ops-num">Keiki</th>
                  <th className="ops-num">Enrolled</th>
                  <th className="ops-num">Lifetime</th>
                  <th>Status</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {families.map((f) => (
                  <tr key={f.parent_id}>
                    <td>
                      <Link
                        href={`/admin/families/${f.parent_id}`}
                        className="flex items-center gap-2.5"
                      >
                        <span
                          className="ops-avatar"
                          style={{
                            background: tintFor(f.email),
                            width: 28,
                            height: 28,
                            fontSize: 10.5,
                          }}
                        >
                          {initials(f.full_name)}
                        </span>
                        <span className="font-medium underline decoration-transparent underline-offset-2 hover:decoration-inherit">
                          {f.full_name}
                        </span>
                      </Link>
                    </td>
                    <td>
                      <p className="ops-mono">{f.email}</p>
                      {f.phone && <p className="ops-mono">{f.phone}</p>}
                    </td>
                    <td className="ops-num">{f.children}</td>
                    <td className="ops-num">{f.active_enrollments}</td>
                    <td className="ops-num font-medium">{formatMoney(f.lifetime_cents)}</td>
                    <td>
                      <div className="flex flex-wrap gap-1.5">
                        {f.open_issues > 0 && (
                          <Pill tone="warn">
                            {f.open_issues} open
                          </Pill>
                        )}
                        {!f.has_account && <Pill tone="quiet">no account</Pill>}
                        {f.open_issues === 0 && f.has_account && <Pill tone="good">ok</Pill>}
                      </div>
                    </td>
                    <td className="text-[var(--ops-muted)]">
                      {f.last_activity ? when(new Date(f.last_activity)) : "never"}
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
