import { redirect } from "next/navigation";
import { currentParent, googleEnabled } from "@/lib/parent-auth";
import { AuthForm } from "./auth-form";

export const dynamic = "force-dynamic";

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const destination = safeNext(next);

  if (await currentParent()) redirect(destination);

  return (
    <div className="mx-auto max-w-md px-5 py-20">
      <span className="kc-eyebrow">Sign in</span>
      <h1 className="mt-5 font-display text-4xl font-bold text-green-900">
        Welcome <span className="kc-highlight">back</span>
      </h1>
      <p className="mt-4 text-ink-soft">
        Your registrations, your keiki and your receipts, all in one place.
      </p>
      <AuthForm mode="signin" next={destination} googleEnabled={googleEnabled} />
    </div>
  );
}

/**
 * Only ever redirect within this site. An open redirect on a login page is how
 * a convincing phishing link gets built out of a domain people trust.
 */
export function safeNext(next: string | undefined) {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/portal";
  return next;
}
