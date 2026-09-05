import { redirect } from "next/navigation";
import { currentStaff } from "@/lib/staff-auth";
import { asUser } from "@keiki/core/rls";
import { navCounts } from "@/app/admin/queries";
import { Rail } from "@/app/admin/rail";
import { signOut } from "@/app/admin/actions";
import { CommandPalette } from "@/app/admin/command-palette";

export const dynamic = "force-dynamic";

/**
 * The office console: everything behind the sign in, and nothing else.
 *
 * Being a route group rather than a plain folder is what makes signing out
 * work. `/admin/login` is outside this group, so leaving the console crosses a
 * layout boundary and this shell unmounts, taking the rail with it. When the
 * rail lived one level up, on a layout the login page shared, a client side
 * navigation to it left the rail on screen.
 *
 * It is also the one place the console checks who you are. Every page used to
 * repeat `if (!(await currentStaff())) redirect(...)`, which is seven chances to
 * forget, and one of them had already been forgotten. `readAsStaff` still
 * redirects on its own, so a page reading data is guarded twice, deliberately:
 * this gate is about not rendering the furniture, that one is about not reading
 * the rows.
 *
 * No brand chrome, on purpose. This is an internal tool read for hours by people
 * who already know what everything means, and the friendly rounded display type
 * that sells a class to a parent gets tiring at that duty cycle. The login page
 * is the single exception, because that is where somebody decides whether they
 * trust what they are looking at.
 */
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const staff = await currentStaff();
  if (!staff) redirect("/admin/login");

  const counts = await asUser(staff.authUserId, (tx) => navCounts(tx));

  return (
    <div className="ops-shell">
      <Rail counts={counts} staff={staff} />

      <div className="min-w-0">
        <header className="ops-topbar">
          <CommandPalette />

          <div className="flex items-center gap-2">
            <span className="ops-pill ops-pill-quiet">
              <span className="ops-dot" style={{ background: "var(--ops-good)" }} />
              Stripe test mode
            </span>
            <a className="ops-btn" href="/" target="_blank" rel="noreferrer">
              Parent site
            </a>
            <form action={signOut}>
              <button className="ops-btn">Sign out</button>
            </form>
          </div>
        </header>

        <main className="px-5 py-6 lg:px-7">{children}</main>
      </div>
    </div>
  );
}
