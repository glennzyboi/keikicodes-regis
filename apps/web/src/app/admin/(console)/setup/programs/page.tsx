import { Suspense } from "react";
import { readAsStaff } from "@/app/admin/queries";
import {
  programList,
  programListCount,
  PROGRAM_SORTS,
  type ProgramFilters,
} from "@/app/admin/setup-queries";
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
  pageFrom,
  sortFrom,
  type SortDir,
} from "@/app/admin/ui";
import { AddProgramButton } from "@/app/admin/setup-forms";

export const dynamic = "force-dynamic";

/**
 * Programs: the curricula, not the classes.
 *
 * The distinction is the whole data model and it was invisible in the old flat
 * table. Their catalogue is 28 offerings across **13** program names, because
 * "Code Heroes: Virtual Reality" runs at five campuses with its own grades,
 * weekday, price and holidays at each. So the useful column here is "campuses",
 * and the useful click is through to the campuses running it.
 */
export default async function Programs({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const page = pageFrom(params.page);
  const { sort, dir } = sortFrom(params.sort, params.dir, PROGRAM_SORTS, "name", "asc");

  const { data: options } = await readAsStaff((tx) => classFilterOptions(tx));

  const filters: ProgramFilters = {
    q: params.q?.trim() || undefined,
    track: params.track || undefined,
    active: params.active === "yes" || params.active === "no" ? params.active : undefined,
    school: options.schools.some((s) => s.id === params.school) ? params.school : undefined,
  };

  const linkParams = { ...filters, sort, dir } as Record<string, string | undefined>;

  return (
    <div className="space-y-4">
      <PageHead
        title="Programs"
        note="A program is a curriculum. The same one runs at several campuses as a separate class each time, with its own grades, day, price and holidays, which is why a program is a record here rather than a title typed onto a class."
        actions={<AddProgramButton />}
      />

      <FilterBar
        basePath="/admin/setup/programs"
        search={{ value: params.q, placeholder: "Program or subject" }}
        selects={[
          {
            name: "track",
            label: "Level",
            value: params.track || undefined,
            anyLabel: "All levels",
            options: options.tracks.map((t) => ({ value: t, label: t })),
          },
          {
            name: "school",
            label: "Runs at",
            value: filters.school,
            anyLabel: "Any campus",
            options: options.schools.map((s) => ({ value: s.id, label: s.name })),
          },
          {
            name: "active",
            label: "Offered",
            value: filters.active,
            anyLabel: "Offered or retired",
            options: [
              { value: "yes", label: "Offered" },
              { value: "no", label: "Retired" },
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
  filters: ProgramFilters;
  page: number;
  sort: (typeof PROGRAM_SORTS)[number];
  dir: SortDir;
  linkParams: Record<string, string | undefined>;
}) {
  const { data } = await readAsStaff(async (tx) => ({
    rows: await programList(tx, filters, { page, perPage: PER_PAGE, sort, dir }),
    total: await programListCount(tx, filters),
  }));

  const base = "/admin/setup/programs";

  return (
    <section className="ops-panel ops-enter">
      {data.rows.length === 0 ? (
        <EmptyState
          icon="book"
          title="No programs match"
          note="Take a filter off, or add a program."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="ops-table">
            <thead>
              <tr>
                <th style={{ width: 44 }} />
                <SortHeader label="Program" column="name" current={sort} dir={dir} basePath={base} params={linkParams} />
                <SortHeader label="Level" column="track" current={sort} dir={dir} basePath={base} params={linkParams} />
                <th>Subject</th>
                <SortHeader label="Classes" column="classes" current={sort} dir={dir} basePath={base} params={linkParams} numeric />
                <SortHeader label="Campuses" column="campuses" current={sort} dir={dir} basePath={base} params={linkParams} numeric />
                <th>Offered</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((p) => (
                <tr key={p.id}>
                  <td>
                    <RowLink href={`${base}/${p.id}`} label={`${p.name}, ${p.campuses} campuses`}>
                      <span className="ops-thumb" data-empty={p.image_url ? undefined : "true"}>
                        {p.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.image_url} alt="" loading="lazy" />
                        ) : (
                          <span aria-hidden>{p.name.slice(0, 1)}</span>
                        )}
                      </span>
                    </RowLink>
                  </td>
                  <td className="font-medium">{p.name}</td>
                  <td className="text-[var(--ops-muted)]">{p.track ?? "—"}</td>
                  <td className="text-[var(--ops-muted)]">{p.subject ?? "—"}</td>
                  <td className="ops-num">{p.offerings}</td>
                  <td className="ops-num">{p.campuses}</td>
                  <td>
                    <Pill tone={p.active ? "good" : "quiet"}>
                      {p.active ? "offered" : "retired"}
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
