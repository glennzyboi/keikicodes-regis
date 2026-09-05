import { Suspense } from "react";
import { readAsStaff } from "@/app/admin/queries";
import {
  campusList,
  campusListCount,
  campusAreas,
  CAMPUS_SORTS,
  type CampusFilters,
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
import { AddCampusButton } from "@/app/admin/setup-forms";

export const dynamic = "force-dynamic";

const KINDS = [
  { value: "public", label: "Public" },
  { value: "private", label: "Private" },
  { value: "charter", label: "Charter" },
];

/**
 * Campuses.
 *
 * Which campuses are open for a term is currently a hand-maintained list of
 * exclusions inside their form builder, with one school listed twice and a
 * "Test School" in production. Here it is a column: a campus is listed to
 * families or it is not, and that is the same fact everywhere it appears.
 */
export default async function Campuses({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const page = pageFrom(params.page);
  const { sort, dir } = sortFrom(params.sort, params.dir, CAMPUS_SORTS, "name", "asc");

  const { data: areas } = await readAsStaff((tx) => campusAreas(tx));

  const filters: CampusFilters = {
    q: params.q?.trim() || undefined,
    kind: KINDS.some((k) => k.value === params.kind) ? params.kind : undefined,
    area: areas.includes(params.area ?? "") ? params.area : undefined,
    active: params.active === "yes" || params.active === "no" ? params.active : undefined,
  };
  const linkParams = { ...filters, sort, dir } as Record<string, string | undefined>;

  return (
    <div className="space-y-4">
      <PageHead
        title="Campuses"
        note="Every campus on file. One with no classes this term still belongs here; it just does not appear to families. Open a campus to see the classes running there."
        actions={<AddCampusButton />}
      />

      <FilterBar
        basePath="/admin/setup/campuses"
        search={{ value: params.q, placeholder: "Campus or area" }}
        selects={[
          {
            name: "kind",
            label: "Kind",
            value: filters.kind,
            anyLabel: "Any kind",
            options: KINDS,
          },
          {
            name: "area",
            label: "Area",
            value: filters.area,
            anyLabel: "All areas",
            options: areas.map((a) => ({ value: a, label: a })),
          },
          {
            name: "active",
            label: "Listed",
            value: filters.active,
            anyLabel: "Listed or hidden",
            options: [
              { value: "yes", label: "Listed to families" },
              { value: "no", label: "Hidden" },
            ],
          },
        ]}
      />

      <Suspense
        key={`${JSON.stringify(filters)}|${page}|${sort}|${dir}`}
        fallback={
          <div className="ops-panel">
            <TableSkeleton rows={PER_PAGE} cols={6} />
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
  filters: CampusFilters;
  page: number;
  sort: (typeof CAMPUS_SORTS)[number];
  dir: SortDir;
  linkParams: Record<string, string | undefined>;
}) {
  const { data } = await readAsStaff(async (tx) => ({
    rows: await campusList(tx, filters, { page, perPage: PER_PAGE, sort, dir }),
    total: await campusListCount(tx, filters),
  }));

  const base = "/admin/setup/campuses";

  return (
    <section className="ops-panel ops-enter">
      {data.rows.length === 0 ? (
        <EmptyState icon="building" title="No campuses match" note="Take a filter off." />
      ) : (
        <div className="overflow-x-auto">
          <table className="ops-table">
            <thead>
              <tr>
                <th style={{ width: 44 }} />
                <SortHeader label="Campus" column="name" current={sort} dir={dir} basePath={base} params={linkParams} />
                <th>Kind</th>
                <SortHeader label="Area" column="area" current={sort} dir={dir} basePath={base} params={linkParams} />
                <SortHeader label="Classes" column="classes" current={sort} dir={dir} basePath={base} params={linkParams} numeric />
                <SortHeader label="Registered" column="enrolled" current={sort} dir={dir} basePath={base} params={linkParams} numeric />
                <th>Listed</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((s) => (
                <tr key={s.id}>
                  <td>
                    <RowLink href={`${base}/${s.id}`} label={`${s.name}, ${s.offerings} classes`}>
                      <span className="ops-thumb" data-empty={s.logo_url ? undefined : "true"}>
                        {s.logo_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={s.logo_url} alt="" loading="lazy" />
                        ) : (
                          <span aria-hidden>{s.name.slice(0, 1)}</span>
                        )}
                      </span>
                    </RowLink>
                  </td>
                  <td className="font-medium">{s.name}</td>
                  <td className="text-[var(--ops-muted)]">{s.kind ?? "—"}</td>
                  <td className="text-[var(--ops-muted)]">{s.area ?? "—"}</td>
                  <td className="ops-num">
                    {s.published}
                    {s.offerings !== s.published && (
                      <span className="text-[var(--ops-faint)]"> of {s.offerings}</span>
                    )}
                  </td>
                  <td className="ops-num">{s.enrolled}</td>
                  <td>
                    <Pill tone={s.active ? "good" : "quiet"}>
                      {s.active ? "listed" : "hidden"}
                    </Pill>
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
