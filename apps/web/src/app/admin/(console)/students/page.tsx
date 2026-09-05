import { Suspense } from "react";
import Link from "next/link";
import { readAsStaff, childRows, childCount, type ChildFilters } from "@/app/admin/queries";
import { classFilterOptions } from "@/app/admin/class-queries";
import { FilterBar } from "@/app/admin/filters";
import {
  EmptyState,
  Icon,
  PageHead,
  Pager,
  Pill,
  RowLink,
  SortHeader,
  TableSkeleton,
  PER_PAGE,
  ageFrom,
  pageFrom,
  sortFrom,
  type SortDir,
} from "@/app/admin/ui";

export const dynamic = "force-dynamic";

const SORTS = ["name", "born", "family", "classes"] as const;

const GRADES = [
  { value: "0", label: "Kindergarten" },
  ...Array.from({ length: 8 }, (_, i) => ({ value: String(i + 1), label: `Grade ${i + 1}` })),
];

/**
 * Every child, across every family.
 *
 * A separate view from Families because the question is genuinely different.
 * Families answers "who is calling"; Students answers "which Kaimana", which is
 * the one you need when a name is shouted across the office and three of them
 * are enrolled this term.
 *
 * The filters are chosen from what gets asked out loud: which campus, what
 * grade, is this child enrolled in anything right now, do they go back to after
 * school care, and is there a note somebody should read before a session.
 */
export default async function Students({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const page = pageFrom(params.page);
  const { sort, dir } = sortFrom(params.sort, params.dir, SORTS, "name", "asc");

  const { data: options } = await readAsStaff((tx) => classFilterOptions(tx));

  const filters: ChildFilters = {
    search: params.q?.trim() || undefined,
    school: options.schools.some((s) => s.id === params.school) ? params.school : undefined,
    grade: GRADES.some((g) => g.value === params.grade) ? params.grade : undefined,
    enrolled: params.enrolled === "yes" || params.enrolled === "no" ? params.enrolled : undefined,
    care: params.care === "yes" ? "yes" : undefined,
    notes: params.notes === "yes" ? "yes" : undefined,
  };

  const linkParams = {
    q: filters.search,
    school: filters.school,
    grade: filters.grade,
    enrolled: filters.enrolled,
    care: filters.care,
    notes: filters.notes,
    sort,
    dir,
  };

  return (
    <div className="space-y-4">
      <PageHead
        title="Students"
        note="Every child on file, with the family they belong to. Medical notes are shown here because the office needs them before a class starts, not after."
      />

      <FilterBar
        basePath="/admin/students"
        search={{ value: params.q, placeholder: "Kaimana, Kealoha, or a parent's email" }}
        selects={[
          {
            name: "school",
            label: "Campus",
            value: filters.school,
            anyLabel: "All campuses",
            options: options.schools.map((s) => ({ value: s.id, label: s.name })),
          },
          {
            name: "grade",
            label: "Grade",
            value: filters.grade,
            anyLabel: "Any grade",
            options: GRADES,
          },
          {
            name: "enrolled",
            label: "Enrolled",
            value: filters.enrolled,
            anyLabel: "Enrolled or not",
            options: [
              { value: "yes", label: "In a class now" },
              { value: "no", label: "Not in a class" },
            ],
          },
          {
            name: "care",
            label: "Care",
            value: filters.care,
            anyLabel: "Care or not",
            options: [{ value: "yes", label: "In after school care" }],
          },
          {
            name: "notes",
            label: "Notes",
            value: filters.notes,
            anyLabel: "With or without notes",
            options: [{ value: "yes", label: "Has a note" }],
          },
        ]}
      />

      <Suspense
        key={`${JSON.stringify(filters)}|${page}|${sort}|${dir}`}
        fallback={
          <div className="ops-panel">
            <TableSkeleton rows={PER_PAGE} cols={5} />
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
  filters: ChildFilters;
  page: number;
  sort: (typeof SORTS)[number];
  dir: SortDir;
  linkParams: Record<string, string | undefined>;
}) {
  const { data } = await readAsStaff(async (tx) => ({
    students: await childRows(tx, { ...filters, page, perPage: PER_PAGE, sort, dir }),
    total: await childCount(tx, filters),
  }));

  const base = "/admin/students";

  return (
    <section className="ops-panel ops-enter">
      <div className="ops-panel-head">
        <h2 className="text-[15px] font-semibold">
          Students
          <span className="ops-pill ops-pill-quiet ml-2 align-middle">{data.total}</span>
        </h2>
      </div>

      {data.students.length === 0 ? (
        <EmptyState
          icon="child"
          title="No student matches"
          note="Take a filter off, or search a parent's email instead."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="ops-table">
            <thead>
              <tr>
                <SortHeader label="Child" column="name" current={sort} dir={dir} basePath={base} params={linkParams} />
                <SortHeader label="Age" column="born" current={sort} dir={dir} basePath={base} params={linkParams} />
                <th>Grade</th>
                <SortHeader label="Family" column="family" current={sort} dir={dir} basePath={base} params={linkParams} />
                <SortHeader label="Classes" column="classes" current={sort} dir={dir} basePath={base} params={linkParams} numeric />
                <th>Notes we hold</th>
              </tr>
            </thead>
            <tbody>
              {data.students.map((c) => (
                <tr key={c.child_id}>
                  <td className="font-medium">
                    <RowLink
                      href={`/admin/students/${c.child_id}`}
                      label={`${c.first_name} ${c.last_name}`}
                    >
                      {c.first_name} {c.last_name}
                      {c.in_afterschool_care && (
                        <span className="ops-pill ops-pill-info ml-2">care</span>
                      )}
                    </RowLink>
                  </td>
                  {/* Age is what staff ask across the office; the birthday is what
                      they check it against. Both, because the catalogue bands by
                      grade and neither number alone settles eligibility. */}
                  <td>
                    {ageFrom(c.date_of_birth) !== null ? (
                      <>
                        <span className="font-medium">{ageFrom(c.date_of_birth)}</span>
                        <span className="ops-mono ml-2">{c.date_of_birth}</span>
                      </>
                    ) : (
                      <span className="text-[var(--ops-muted)]">{c.date_of_birth}</span>
                    )}
                  </td>
                  <td className="text-[var(--ops-muted)]">
                    {c.grade === null ? "—" : c.grade === 0 ? "K" : c.grade}
                  </td>
                  <td>
                    <Link
                      href={`/admin/families/${c.parent_id}`}
                      className="ops-cell-top underline decoration-dotted underline-offset-2"
                    >
                      {c.parent_name}
                    </Link>
                    <p className="ops-mono">{c.parent_email}</p>
                  </td>
                  <td className="ops-num">{c.enrollments}</td>
                  <td>
                    {/* Clamped, with the whole note on the title. A medical note
                        can be a paragraph, and one of those in a pill stretches
                        every row on the page. */}
                    {c.notes ? (
                      <span className="ops-pill ops-pill-warn" title={c.notes}>
                        <Icon name="warning" size={11} />
                        <span className="ops-clamp">{c.notes}</span>
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

      <Pager page={page} total={data.total} basePath={base} params={linkParams} />
    </section>
  );
}
