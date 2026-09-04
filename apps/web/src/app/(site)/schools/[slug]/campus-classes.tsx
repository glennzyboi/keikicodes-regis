"use client";

import { useMemo, useState } from "react";
import { ClassCard } from "../../class-card";
import { GRADE_LABELS, gradeFits } from "@/lib/grades";
import type { Offering } from "@/lib/catalogue";

/**
 * The classes at one campus, filtered by the grade the child is in.
 *
 * Two rules, both learned from what their form does badly.
 *
 * A filter must never silently swallow things. When the grade filter hides
 * classes, the page says how many and offers to show them, because a parent who
 * came for a specific class and cannot find it will assume the site is broken
 * rather than that they typed the wrong grade.
 *
 * A class the school enrols itself is not hidden either. It is real, it is
 * running, and a parent needs to know it exists and where to go. It just cannot
 * be bought here.
 */
export function CampusClasses({ offerings }: { offerings: Offering[] }) {
  const [grade, setGrade] = useState<number | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  const { fits, hidden } = useMemo(() => {
    const fits: Offering[] = [];
    const hidden: Offering[] = [];
    for (const o of offerings) (gradeFits(grade, o) ? fits : hidden).push(o);
    return { fits, hidden };
  }, [offerings, grade]);

  const shown = showHidden ? offerings : fits;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="kc-fieldset w-full max-w-xs">
          <label htmlFor="grade-filter">Which grade is your child in?</label>
          <select
            id="grade-filter"
            value={grade === null ? "" : String(grade)}
            onChange={(e) => {
              setGrade(e.target.value === "" ? null : Number(e.target.value));
              setShowHidden(false);
            }}
          >
            <option value="">Any grade</option>
            {GRADE_LABELS.map((label, g) => (
              <option key={label} value={g}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <p className="text-sm text-ink-soft">
          {shown.length} {shown.length === 1 ? "class" : "classes"} shown
        </p>
      </div>

      {grade !== null && hidden.length > 0 && (
        <p className="mt-4 rounded-xl border border-hairline bg-white px-4 py-3 text-sm text-ink-soft">
          {hidden.length} {hidden.length === 1 ? "class is" : "classes are"} for other
          grades and {hidden.length === 1 ? "is" : "are"} {showHidden ? "shown below" : "hidden"}.{" "}
          <button type="button" className="kc-link" onClick={() => setShowHidden((v) => !v)}>
            {showHidden ? "Hide them again" : "Show them anyway"}
          </button>
        </p>
      )}

      {shown.length === 0 ? (
        <p className="mt-8 rounded-xl border border-hairline bg-white px-5 py-6 text-sm text-ink-soft">
          Nothing at this campus is open to that grade this term.
        </p>
      ) : (
        <div className="kc-stagger mt-8 grid items-start gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((o) => (
            <ClassCard key={o.id} cls={o} showCampus={false} />
          ))}
        </div>
      )}
    </>
  );
}
