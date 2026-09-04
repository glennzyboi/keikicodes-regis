import Link from "next/link";
import { CatalogueTabs } from "./tabs";

/**
 * The catalogue section.
 *
 * Four things, one page each, because they are four different jobs and putting
 * them on one screen is how a console ends up feeling like a database browser.
 * Classes is where the office spends its time; the other three are where the
 * words on a class come from.
 */
export default function CatalogueLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CatalogueTabs />
        <Link href="/admin/catalogue/classes/new" className="ops-btn ops-btn-primary">
          New class
        </Link>
      </div>
      {children}
    </div>
  );
}
