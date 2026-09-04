import { redirect } from "next/navigation";
import { currentStaff } from "@/lib/staff-auth";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function AdminLogin() {
  if (await currentStaff()) redirect("/admin");

  return (
    <div className="mx-auto max-w-md px-5 py-24">
      <span className="kc-eyebrow">Staff</span>
      <h1 className="mt-5 font-display text-4xl font-bold text-green-900">
        Office <span className="kc-highlight">sign in</span>
      </h1>
      <p className="mt-4 text-ink-soft">
        Staff accounts see every family&apos;s details, so this one needs a password.
        Parents never do.
      </p>
      <LoginForm />
    </div>
  );
}
