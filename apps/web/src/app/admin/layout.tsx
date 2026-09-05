import type { Metadata } from "next";
import "./ops.css";

export const metadata: Metadata = {
  title: "Keiki Coders Ops",
  description: "Registration operations console.",
};

/**
 * The outer frame of everything at /admin, and deliberately almost nothing.
 *
 * This used to hold the rail, and holding the rail here was a bug with a
 * surprising cause. `/admin/login` sits under this layout, so it is a **sibling**
 * of every console page beneath a shared layout, and Next does not re-render a
 * shared layout on a client side navigation between siblings. Signing out is a
 * client navigation. So the page swapped to the login form and the rail, already
 * mounted, simply stayed there: signed out, still looking at the console's
 * furniture. A hard reload looked correct, which is exactly why it read as
 * "weird" rather than as broken.
 *
 * The console now lives in a (console) route group with its own layout, so
 * moving between the login page and the console crosses a layout boundary and
 * the shell genuinely unmounts.
 *
 * ops.css is imported here and nowhere else, so the split between the parent
 * site's typography and this one is enforced by the module graph rather than by
 * everyone remembering. The login page needs it too, which is the other reason
 * it stays at this level rather than moving into the group.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <div className="ops">{children}</div>;
}
