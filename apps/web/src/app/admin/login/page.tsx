import { redirect } from "next/navigation";
import { currentStaff } from "@/lib/staff-auth";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function AdminLogin() {
  if (await currentStaff()) redirect("/admin");

  return (
    <div className="grid min-h-screen place-items-center px-5">
      <div className="ops-panel w-full max-w-sm p-6">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="grid h-6 w-6 place-items-center rounded bg-[var(--ops-text)] text-[11px] font-bold text-white"
          >
            K
          </span>
          <span className="font-semibold">Keiki Ops</span>
        </div>
        <h1 className="mt-4 text-[17px] font-semibold">Sign in</h1>
        <p className="mt-1 text-[var(--ops-muted)]">
          Staff accounts see every family&apos;s details, so this side needs a password.
          Parents never do.
        </p>
        <LoginForm />
      </div>
    </div>
  );
}
