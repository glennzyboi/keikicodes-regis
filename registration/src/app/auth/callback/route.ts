import { NextResponse } from "next/server";
import { supabaseParent, currentParent } from "@/lib/parent-auth";

export const dynamic = "force-dynamic";

/**
 * Where Google sends them back to.
 *
 * Exchanges the one time code for a session, makes sure the parents row exists,
 * then forwards them to wherever they were going. The next parameter is checked
 * rather than trusted: an open redirect here would let someone build a phishing
 * link on a domain families recognise.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const requested = url.searchParams.get("next") ?? "/portal";
  const next = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/portal";

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=missing_code", url.origin));
  }

  const supabase = await supabaseParent();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL("/login?error=sign_in_failed", url.origin));
  }

  await currentParent();
  return NextResponse.redirect(new URL(next, url.origin));
}
