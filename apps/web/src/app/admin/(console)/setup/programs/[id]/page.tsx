import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { readAsStaff } from "@/app/admin/queries";
import { programOne } from "@/app/admin/setup-queries";
import { classFilterOptions, CLASS_SORTS, type ClassSort } from "@/app/admin/class-queries";
import { FilterBar } from "@/app/admin/filters";
import { PageHead, Pill, pageFrom, sortFrom } from "@/app/admin/ui";
import { ClassList, ClassListSkeleton, type ClassListView } from "../../../classes/class-list";
import { classFiltersFrom, classSelects } from "../../../classes/filters-config";
import { EditProgram } from "@/app/admin/setup-edit";
import { ImageField } from "@/app/admin/image-field";

export const dynamic = "force-dynamic";

/**
 * One program, and everywhere it runs.
 *
 * The body of this page is the Classes list with `program` already applied. Not
 * a copy of it, the same component: `/admin/classes?program=X` and this page
 * render identical rows from one query. That is what "no repetition" means in
 * practice, and it is why the campuses running a program can never disagree with
 * the class list about how full they are.
 *
 * This view is also the first place the data model is visible. Their catalogue
 * is 28 offerings across 13 program names, so a program with five campuses under
 * it is the normal case rather than a curiosity.
 */
export default async function ProgramDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const { data } = await readAsStaff(async (tx) => ({
    program: await programOne(tx, id),
    options: await classFilterOptions(tx),
  }));
  if (!data.program) notFound();

  const p = data.program;
  const page = pageFrom(sp.page);
  const view: ClassListView = sp.view === "table" ? "table" : "cards";
  const { sort, dir } = sortFrom(sp.sort, sp.dir, CLASS_SORTS, "default");
  const { filters, termValue } = classFiltersFrom(sp, data.options.currentTermId, {
    program: id,
  });

  const base = `/admin/setup/programs/${id}`;
  const linkParams = { ...sp, page: undefined } as Record<string, string | undefined>;

  return (
    <div className="space-y-4">
      <Link href="/admin/setup/programs" className="ops-mono inline-flex items-center gap-1">
        &larr; All programs
      </Link>

      <div className="ops-panel ops-enter ops-classhead">
        <div className="ops-classhead-art" data-empty={p.image_url ? undefined : "true"}>
          {p.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.image_url} alt="" />
          ) : (
            <span aria-hidden>{p.name.slice(0, 1)}</span>
          )}
        </div>
        <div className="ops-classhead-body">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <span className="ops-label">{p.track ?? "No level set"}</span>
              <h1 className="mt-1 text-[21px] font-semibold">{p.name}</h1>
              <p className="mt-1 text-[var(--ops-muted)]">
                {p.subject ? `${p.subject} · ` : ""}
                {p.offerings} class{p.offerings === 1 ? "" : "es"} at {p.campuses} campus
                {p.campuses === 1 ? "" : "es"} · {p.enrolled} registered
              </p>
              {p.description && (
                <p className="mt-2 max-w-2xl text-[var(--ops-muted)]">{p.description}</p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={p.active ? "good" : "quiet"}>{p.active ? "offered" : "retired"}</Pill>
              <EditProgram
                program={{
                  id: p.id,
                  name: p.name,
                  track: p.track,
                  subject: p.subject,
                  description: p.description,
                  active: p.active,
                }}
              />
            </div>
          </div>
        </div>
      </div>

      <section className="ops-panel ops-enter p-4">
        <ImageField
          kind="program"
          id={p.id}
          url={p.image_url}
          label="Program picture"
          note={`Shown on the card a parent picks from, on every one of the ${p.offerings} classes running this program.`}
        />
      </section>

      <PageHead
        title="Where it runs"
        note="The same list as Classes, filtered to this program. One component, one query, so these rows and that page can never disagree."
      />

      <FilterBar
        basePath={base}
        search={{ value: sp.q, placeholder: "Class or campus" }}
        selects={classSelects(sp, data.options, termValue, ["program"])}
        segment={{
          name: "view",
          label: "How to show the list",
          value: view,
          options: [
            { value: "cards", label: "Cards" },
            { value: "table", label: "Table" },
          ],
        }}
      />

      <Suspense
        key={`${JSON.stringify(filters)}|${view}|${page}|${sort}|${dir}`}
        fallback={<ClassListSkeleton view={view} />}
      >
        <ClassList
          filters={filters}
          view={view}
          page={page}
          sort={sort as ClassSort}
          dir={dir}
          basePath={base}
          linkParams={linkParams}
        />
      </Suspense>
    </div>
  );
}
