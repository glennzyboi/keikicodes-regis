import { redirect } from "next/navigation";
import { currentParent, googleEnabled } from "@/lib/parent-auth";
import { AuthForm } from "../login/auth-form";
import { safeNext } from "@/lib/forms";

export const dynamic = "force-dynamic";

export default async function SignUp({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const destination = safeNext(next);

  if (await currentParent()) redirect(destination);

  return (
    <div className="mx-auto max-w-md px-5 py-20">
      <span className="kc-eyebrow">Create an account</span>
      <h1 className="mt-5 font-display text-4xl font-bold text-green-900">
        One account for <span className="kc-highlight">every term</span>
      </h1>
      <p className="mt-4 text-ink-soft">
        Add your keiki once and register them again next term without typing
        anything twice. Your details stay behind a password rather than a link in
        an inbox.
      </p>
      <AuthForm mode="signup" next={destination} googleEnabled={googleEnabled} />
    </div>
  );
}
