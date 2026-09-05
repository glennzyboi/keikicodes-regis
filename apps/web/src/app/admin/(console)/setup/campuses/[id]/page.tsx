import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { readAsStaff } from "@/app/admin/queries";
import { campusOne } from "@/app/admin/setup-queries";
import { classFilterOptions, CLASS_SORTS, type ClassSort } from "@/app/admin/class-queries";
import { FilterBar } from "@/app/admin/filters";
import { EditCampus } from "@/app/admin/setup-edit";
import { ImageField } from "@/app/admin/image-field";
import { PageHead, Pill, pageFrom, sortFrom } from "@/app/admin/ui";
import { ClassList, ClassListSkeleton, type ClassListView } from "../../../classes/class-list";
import { classFiltersFrom, classSelects } from "../../../classes/filters-config";

export const dynamic = "force-dynamic";

/**
 * One campus, and everything running at it.
 *
 * Same component as `/admin/classes?school=X`, with the campus filter pinned
 * and its dropdown hidden. Two entrances, one list.
 */
export default async function CampusDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const { data } = await readAsStaff(async (tx) => ({
    campus: await campusOne(tx, id),
    options: await classFilterOptions(tx),
  }));
  if (!data.campus) notFound();

  const s = data.campus;
  const page = pageFrom(sp.page);
  const view: ClassListView = sp.view === "table" ? "table" : "cards";
  const { sort, dir } = sortFrom(sp.sort, sp.dir, CLASS_SORTS, "default");
  const { filters, termValue } = classFiltersFrom(sp, data.options.currentTermId, {
    school: id,
  });

  const base = `/admin/setup/campuses/${id}`;
  const linkParams = { ...sp, page: undefined } as Record<string, string | undefined>;

  return (
    <div className="space-y-4">
      <Link href="/admin/setup/campuses" className="ops-mono inline-flex items-center gap-1">
        &larr; All campuses
      </Link>

      <div className="ops-panel ops-enter p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="ops-thumb ops-thumb-lg" data-empty={s.logo_url ? undefined : "true"}>
              {s.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.logo_url} alt="" />
              ) : (
                <span aria-hidden>{s.name.slice(0, 1)}</span>
              )}
            </span>
            <div className="min-w-0">
              <span className="ops-label">{s.kind ?? "Kind not set"}</span>
              <h1 className="mt-1 text-[21px] font-semibold">{s.name}</h1>
              <p className="mt-1 text-[var(--ops-muted)]">
                {s.area ? `${s.area} · ` : ""}
                {s.timezone} · {s.published} of {s.offerings} classes published ·{" "}
                {s.enrolled} registered
              </p>
              {s.external_url && (
                <p className="mt-1">
                  <a
                    className="ops-mono underline decoration-dotted underline-offset-2"
                    href={s.external_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    They take their own registrations here
                  </a>
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={s.active ? "good" : "quiet"}>{s.active ? "listed" : "hidden"}</Pill>
            <Link href={`/schools/${s.slug}`} target="_blank" className="ops-btn">
              View as a parent
            </Link>
            <EditCampus
              campus={{
                id: s.id,
                name: s.name,
                kind: s.kind,
                area: s.area,
                timezone: s.timezone,
                externalUrl: s.external_url,
                active: s.active,
              }}
            />
          </div>
        </div>
      </div>

      <section className="ops-panel ops-enter p-4">
        <ImageField
          kind="campus"
          id={s.id}
          url={s.logo_url}
          label="Campus logo"
          note="Shown on the campus picker a parent starts from, and beside every class here."
        />
      </section>

      <PageHead
        title="Classes here"
        note="The same list as Classes, filtered to this campus. One component, one query."
      />

      <FilterBar
        basePath={base}
        search={{ value: sp.q, placeholder: "Class or program" }}
        selects={classSelects(sp, data.options, termValue, ["school"])}
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
