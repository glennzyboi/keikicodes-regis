import { Suspense } from "react";
import { formatMoney } from "@keiki/core/stripe";
import {
  readAsStaff,
  familyRows,
  familyCount,
  type FamilyFilters,
} from "@/app/admin/queries";
import { classFilterOptions } from "@/app/admin/class-queries";
import { FilterBar } from "@/app/admin/filters";
import {
  EmptyState,
  PageHead,
  Pager,
  Pill,
  RowLink,
  SortHeader,
  TableSkeleton,
  PER_PAGE,
  initials,
  pageFrom,
  sortFrom,
  tintFor,
  when,
  type SortDir,
} from "@/app/admin/ui";

export const dynamic = "force-dynamic";

const SORTS = ["name", "children", "enrolled", "lifetime", "seen"] as const;

/**
 * The list somebody lands on when the phone rings.
 *
 * Search covers the parent's name, their email and their children's names,
 * because a caller says "I'm Kaimana's mum" at least as often as they give their
 * own name.
 *
 * "Open issues" is the filter that earns its keep: a cancellation waiting on a
 * decision, or a refund still owed. It turns a list of everybody into a list of
 * the people somebody has to ring back today.
 */
export default async function Families({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const page = pageFrom(params.page);
  const { sort, dir } = sortFrom(params.sort, params.dir, SORTS, "seen");

  const { data: options } = await readAsStaff((tx) => classFilterOptions(tx));

  const filters: FamilyFilters = {
    search: params.q?.trim() || undefined,
    account: params.account === "yes" || params.account === "no" ? params.account : undefined,
    issues: params.issues === "yes" ? "yes" : undefined,
    school: options.schools.some((s) => s.id === params.school) ? params.school : undefined,
  };

  const linkParams = {
    q: filters.search,
    account: filters.account,
    issues: filters.issues,
    school: filters.school,
    sort,
    dir,
  };

  return (
    <div className="space-y-4">
      <PageHead
        title="Families"
        note="Everyone with an account or a registration. Search by parent name, email, or the name of a child."
      />

      <FilterBar
        basePath="/admin/families"
        search={{ value: params.q, placeholder: "Kealoha, kaimana, parent@example.com" }}
        selects={[
          {
            name: "issues",
            label: "Needs",
            value: filters.issues,
            anyLabel: "Everyone",
            options: [{ value: "yes", label: "Waiting on us" }],
          },
          {
            name: "school",
            label: "Campus",
            value: filters.school,
            anyLabel: "All campuses",
            options: options.schools.map((s) => ({ value: s.id, label: s.name })),
          },
          {
            name: "account",
            label: "Account",
            value: filters.account,
            anyLabel: "With or without an account",
            options: [
              { value: "yes", label: "Has an account" },
              { value: "no", label: "No account yet" },
            ],
          },
        ]}
      />

      <Suspense
        key={`${JSON.stringify(filters)}|${page}|${sort}|${dir}`}
        fallback={
          <div className="ops-panel">
            <TableSkeleton rows={PER_PAGE} cols={7} />
          </div>
        }
      >
        <Rows filters={filters} page={page} sort={sort} dir={dir} linkParams={linkParams} />
      </Suspense>
    </div>
  );
}

async function Rows({
  filters,
  page,
  sort,
  dir,
  linkParams,
}: {
  filters: FamilyFilters;
  page: number;
  sort: (typeof SORTS)[number];
  dir: SortDir;
  linkParams: Record<string, string | undefined>;
}) {
  // Both in one transaction, so the count and the rows can never describe two
  // different moments: "1 to 10 of 9" is the kind of thing people report as a
  // bug forever afterwards.
  const { data } = await readAsStaff(async (tx) => ({
    families: await familyRows(tx, filters, page, PER_PAGE, sort, dir),
    total: await familyCount(tx, filters),
  }));

  const base = "/admin/families";

  return (
    <section className="ops-panel ops-enter">
      <div className="ops-panel-head">
        <div>
          <h2 className="text-[15px] font-semibold">
            Families
            <span className="ops-pill ops-pill-quiet ml-2 align-middle">{data.total}</span>
          </h2>
          <p className="mt-0.5 text-[var(--ops-muted)]">
            Newest activity first. Open a family to see everything about them.
          </p>
        </div>
      </div>

      {data.families.length === 0 ? (
        <EmptyState
          icon="users"
          title="Nobody matches"
          note="Try part of an email address, or a child's first name."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="ops-table">
            <thead>
              <tr>
                <SortHeader label="Family" column="name" current={sort} dir={dir} basePath={base} params={linkParams} />
                <th>Contact</th>
                <SortHeader label="Keiki" column="children" current={sort} dir={dir} basePath={base} params={linkParams} numeric />
                <SortHeader label="Enrolled" column="enrolled" current={sort} dir={dir} basePath={base} params={linkParams} numeric />
                <SortHeader label="Lifetime" column="lifetime" current={sort} dir={dir} basePath={base} params={linkParams} numeric />
                <th>Status</th>
                <SortHeader label="Last seen" column="seen" current={sort} dir={dir} basePath={base} params={linkParams} />
              </tr>
            </thead>
            <tbody>
              {data.families.map((f) => (
                <tr key={f.parent_id}>
                  <td>
                    <RowLink href={`/admin/families/${f.parent_id}`} label={f.full_name}>
                      <span className="flex items-center gap-2.5">
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
                        <span className="font-medium">{f.full_name}</span>
                      </span>
                    </RowLink>
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
                      {f.open_issues > 0 && <Pill tone="warn">{f.open_issues} open</Pill>}
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

      <Pager page={page} total={data.total} basePath={base} params={linkParams} />
    </section>
  );
}
