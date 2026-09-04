import type { Metadata } from "next";
import "./ops.css";
import { currentStaff } from "@/lib/staff-auth";
import { asUser } from "@keiki/core/rls";
import { navCounts } from "./queries";
import { Rail } from "./rail";
import { signOut } from "./actions";
import { CommandPalette } from "./command-palette";

export const metadata: Metadata = {
  title: "Keiki Coders Ops",
  description: "Registration operations console.",
};

export const dynamic = "force-dynamic";

/**
 * The office console.
 *
 * No brand chrome, on purpose. This is an internal tool read for hours by
 * people who already know what everything means, and the friendly rounded
 * display type that sells a class to a parent gets tiring at that duty cycle.
 * ops.css is imported here and nowhere else, so the split is enforced by the
 * module graph rather than by everyone remembering.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const staff = await currentStaff();

  // Signed out, or signing in. The login page draws its own frame.
  if (!staff) return <div className="ops">{children}</div>;

  const counts = await asUser(staff.authUserId, (tx) => navCounts(tx));

  return (
    <div className="ops">
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
    </div>
  );
}
