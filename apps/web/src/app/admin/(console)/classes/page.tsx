import { Suspense } from "react";
import Link from "next/link";
import { readAsStaff } from "@/app/admin/queries";
import { classFilterOptions, CLASS_SORTS, type ClassSort } from "@/app/admin/class-queries";
import { FilterBar } from "@/app/admin/filters";
import { PageHead, pageFrom, sortFrom } from "@/app/admin/ui";
import { ClassList, ClassListSkeleton, type ClassListView } from "./class-list";
import { classFiltersFrom, classSelects } from "./filters-config";

export const dynamic = "force-dynamic";

/**
 * Classes: the one place the office works.
 *
 * This replaces two pages that were front doors onto the same 28 records, one
 * called Catalogue and one called Rosters. Staff had to know which tab a job
 * lived on before they could start it, and the two lists had already drifted
 * into sorting and counting differently.
 *
 * **The list defaults to the current term.** Their business runs on one term at
 * a time and their own form hard-codes it; an unfiltered list of every class
 * that ever ran is nobody's question. The default is still shown as a chip,
 * because a filter you cannot see is a lie about what you are looking at, and
 * taking the chip off widens to every term rather than putting the default
 * straight back.
 */
export default async function Classes({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const page = pageFrom(params.page);
  const view: ClassListView = params.view === "table" ? "table" : "cards";
  const { sort, dir } = sortFrom(params.sort, params.dir, CLASS_SORTS, "default");

  const { data: options } = await readAsStaff((tx) => classFilterOptions(tx));
  const { filters, termValue } = classFiltersFrom(params, options.currentTermId);

  // Everything that has to survive a sort link or a page link.
  const linkParams = {
    q: params.q,
    school: params.school,
    term: params.term,
    program: params.program,
    track: params.track,
    status: params.status,
    mode: params.mode,
    weekday: params.weekday,
    fill: params.fill,
    view: params.view,
    sort: sort === "default" ? undefined : sort,
    dir: sort === "default" ? undefined : dir,
  };

  return (
    <div className="space-y-4">
      <PageHead
        title="Classes"
        note="A class is one program, at one campus, in one term. The same program runs at several campuses with its own day, grades and price at each, so the campus is a filter here rather than a folder to go hunting in."
        actions={
          <Link href="/admin/classes/new" className="ops-btn ops-btn-primary">
            New class
          </Link>
        }
      />

      <FilterBar
        basePath="/admin/classes"
        search={{ value: params.q, placeholder: "Class, campus or program" }}
        selects={classSelects(params, options, termValue)}
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

      {/*
        The boundary is keyed on the filter state, and that key is what makes a
        skeleton appear at all.

        Ten `loading.tsx` files already existed, and none of them fired on a
        filter change: `loading.tsx` covers arriving at a route, not changing the
        query string on one you are already on. So every filter, sort and page
        click sat there doing nothing visible until the new rows appeared. A new
        key is a new boundary, which React cannot reuse, so it has to show the
        fallback while the rows are read.
      */}
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
          basePath="/admin/classes"
          linkParams={linkParams}
        />
      </Suspense>
    </div>
  );
}
