import { Suspense } from "react";
import { readAsStaff } from "@/app/admin/queries";
import {
  termList,
  termListCount,
  TERM_SORTS,
  type TermFilters,
} from "@/app/admin/setup-queries";
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
  pageFrom,
  sortFrom,
  type SortDir,
} from "@/app/admin/ui";
import { AddTermButton } from "@/app/admin/setup-forms";

export const dynamic = "force-dynamic";

const WHEN = [
  { value: "current", label: "The current term" },
  { value: "upcoming", label: "Not started yet" },
  { value: "past", label: "Finished" },
];

/**
 * Terms.
 *
 * Rolling to the next term is ticking a box here. In their current system it is
 * editing the same typed string, "Fall 2026", in three separate filters inside a
 * form builder, and the class list defaults to whichever term this page says is
 * current.
 */
export default async function Terms({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const page = pageFrom(params.page);
  const { sort, dir } = sortFrom(params.sort, params.dir, TERM_SORTS, "starts");

  const filters: TermFilters = {
    q: params.q?.trim() || undefined,
    when: WHEN.some((w) => w.value === params.when) ? params.when : undefined,
  };
  const linkParams = { ...filters, sort, dir } as Record<string, string | undefined>;

  return (
    <div className="space-y-4">
      <PageHead
        title="Terms"
        note="Which term is current decides what families see first and what the Classes list shows by default. Only one can be current; ticking one unticks the other."
        actions={<AddTermButton />}
      />

      <FilterBar
        basePath="/admin/setup/terms"
        search={{ value: params.q, placeholder: "Term name" }}
        selects={[
          {
            name: "when",
            label: "When",
            value: filters.when,
            anyLabel: "Every term",
            options: WHEN,
          },
        ]}
      />

      <Suspense
        key={`${JSON.stringify(filters)}|${page}|${sort}|${dir}`}
        fallback={
          <div className="ops-panel">
            <TableSkeleton rows={6} cols={5} />
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
  filters: TermFilters;
  page: number;
  sort: (typeof TERM_SORTS)[number];
  dir: SortDir;
  linkParams: Record<string, string | undefined>;
}) {
  const { data } = await readAsStaff(async (tx) => ({
    rows: await termList(tx, filters, { page, perPage: PER_PAGE, sort, dir }),
    total: await termListCount(tx, filters),
  }));

  const base = "/admin/setup/terms";

  return (
    <section className="ops-panel ops-enter">
      {data.rows.length === 0 ? (
        <EmptyState icon="calendar" title="No terms match" note="Take a filter off." />
      ) : (
        <div className="overflow-x-auto">
          <table className="ops-table">
            <thead>
              <tr>
                <SortHeader label="Term" column="name" current={sort} dir={dir} basePath={base} params={linkParams} />
                <SortHeader label="Starts" column="starts" current={sort} dir={dir} basePath={base} params={linkParams} />
                <th>Ends</th>
                <SortHeader label="Classes" column="classes" current={sort} dir={dir} basePath={base} params={linkParams} numeric />
                <th className="ops-num">Registered</th>
                <th>Current</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((t) => (
                <tr key={t.id}>
                  <td className="font-medium">
                    <RowLink href={`${base}/${t.id}`} label={`${t.name}, ${t.offerings} classes`}>
                      {t.name}
                    </RowLink>
                  </td>
                  <td className="text-[var(--ops-muted)]">{t.starts_on}</td>
                  <td className="text-[var(--ops-muted)]">{t.ends_on}</td>
                  <td className="ops-num">{t.offerings}</td>
                  <td className="ops-num">{t.enrolled}</td>
                  <td>{t.is_current && <Pill tone="good">current</Pill>}</td>
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
