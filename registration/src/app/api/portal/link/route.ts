import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "@/lib/db";
import { portalUrl } from "@/lib/portal-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ email: z.string().email().max(200) });

/**
 * Reissue a portal link.
 *
 * This always answers the same way, whether or not the address is on file. A
 * different answer for a known address turns this endpoint into a way of asking
 * whether a given family uses Keiki Coders, and with children involved that is
 * not a question a stranger gets to ask.
 *
 * In production the link is emailed and never returned in the response. There
 * is no mail server in this trial build, so the link comes back in the body
 * instead, which is safe only because it is gated on NODE_ENV.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const [parent] = await sql<{ id: string }[]>`
    select id from parents where email = ${parsed.data.email.trim().toLowerCase()}`;

  if (parent) {
    const link = portalUrl(parent.id);
    console.log(`[portal] link for ${parsed.data.email}: ${link}`);

    if (process.env.NODE_ENV !== "production") {
      return NextResponse.json({ ok: true, demoLink: link });
    }
  }

  return NextResponse.json({ ok: true });
}
