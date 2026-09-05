import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { readAsStaff } from "@/app/admin/queries";
import { termOne } from "@/app/admin/setup-queries";
import { classFilterOptions, CLASS_SORTS, type ClassSort } from "@/app/admin/class-queries";
import { FilterBar } from "@/app/admin/filters";
import { EditTerm } from "@/app/admin/setup-edit";
import { PageHead, Pill, pageFrom, sortFrom } from "@/app/admin/ui";
import { ClassList, ClassListSkeleton, type ClassListView } from "../../../classes/class-list";
import { classFiltersFrom, classSelects } from "../../../classes/filters-config";

export const dynamic = "force-dynamic";

/**
 * One term, and everything in it.
 *
 * The term filter is pinned to this one rather than defaulting to the current
 * term, which is the point of being on a term's page: looking at last spring
 * should show last spring.
 */
export default async function TermDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const { data } = await readAsStaff(async (tx) => ({
    term: await termOne(tx, id),
    options: await classFilterOptions(tx),
  }));
  if (!data.term) notFound();

  const t = data.term;
  const page = pageFrom(sp.page);
  const view: ClassListView = sp.view === "table" ? "table" : "cards";
  const { sort, dir } = sortFrom(sp.sort, sp.dir, CLASS_SORTS, "default");
  const { filters } = classFiltersFrom(sp, data.options.currentTermId, { term: id });

  const base = `/admin/setup/terms/${id}`;
  const linkParams = { ...sp, page: undefined } as Record<string, string | undefined>;

  return (
    <div className="space-y-4">
      <Link href="/admin/setup/terms" className="ops-mono inline-flex items-center gap-1">
        &larr; All terms
      </Link>

      <div className="ops-panel ops-enter p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="ops-label">Term</span>
            <h1 className="mt-1 text-[21px] font-semibold">{t.name}</h1>
            <p className="mt-1 text-[var(--ops-muted)]">
              {t.starts_on} to {t.ends_on} · {t.offerings} class
              {t.offerings === 1 ? "" : "es"} · {t.enrolled} registered
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {t.is_current && <Pill tone="good">current</Pill>}
            <EditTerm
              term={{
                id: t.id,
                name: t.name,
                startsOn: t.starts_on,
                endsOn: t.ends_on,
                isCurrent: t.is_current,
              }}
            />
          </div>
        </div>
      </div>

      <PageHead
        title="Classes this term"
        note="The same list as Classes, pinned to this term rather than to whichever one is current."
      />

      <FilterBar
        basePath={base}
        search={{ value: sp.q, placeholder: "Class, campus or program" }}
        selects={classSelects(sp, data.options, id, ["term"])}
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
