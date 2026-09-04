/**
 * Grades, and nothing else.
 *
 * This is deliberately its own file with no imports. The label list and the
 * eligibility check are needed by client components, and the moment they lived
 * next to a query the Postgres driver followed them into the browser bundle and
 * the whole app 500ed on "Can't resolve 'fs'".
 *
 * That is the second time a helper sitting beside server code has done this,
 * the first being a currency formatter next to the Stripe client. The rule
 * that comes out of it: anything a "use client" file imports for its value
 * belongs in a module that imports nothing from the server.
 */

export const GRADE_LABELS = [
  "Kindergarten",
  "Grade 1",
  "Grade 2",
  "Grade 3",
  "Grade 4",
  "Grade 5",
  "Grade 6",
  "Grade 7",
  "Grade 8",
  "Grade 9",
  "Grade 10",
  "Grade 11",
  "Grade 12",
];

/** Kindergarten is 0, matching the column. */
export const gradeName = (g: number) => GRADE_LABELS[g] ?? `Grade ${g}`;

/** "K-2", "4-6", "Grade 1". Null when the class does not say. */
export function gradeRangeLabel(min: number | null, max: number | null): string | null {
  if (min === null && max === null) return null;
  const lo = min === null ? "any" : min === 0 ? "K" : String(min);
  const hi = max === null ? "any" : max === 0 ? "K" : String(max);
  return lo === hi ? `Grade ${lo}` : `Grades ${lo} to ${hi}`;
}

/** Is this child's grade inside the class's range? */
export function gradeFits(
  grade: number | null,
  range: { gradeMin: number | null; gradeMax: number | null },
): boolean {
  if (grade === null) return true;
  if (range.gradeMin !== null && grade < range.gradeMin) return false;
  if (range.gradeMax !== null && grade > range.gradeMax) return false;
  return true;
}
