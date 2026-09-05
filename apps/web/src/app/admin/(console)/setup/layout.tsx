/**
 * Setup: the words a class is assembled from.
 *
 * Programs, campuses and terms are reference data. They are edited rarely, by
 * one or two people, and everything else in the console points at them. They
 * are deliberately not a place anybody works: the work happens on Classes, and
 * these three exist so a class can be assembled from records rather than from
 * strings retyped into a form builder.
 *
 * No tab strip here any more. The rail already lists all four of these, and a
 * second row of the same four links directly underneath it was the console
 * telling you twice where you were.
 */
export default function SetupLayout({ children }: { children: React.ReactNode }) {
  return <div className="space-y-5">{children}</div>;
}
