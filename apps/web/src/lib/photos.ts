import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Showing a child's photograph to staff.
 *
 * The bucket is private, so there is no URL to put in an img tag. Reading one
 * is a signed request that expires, minted here on the server for a staff
 * member who has already been authorised by the page calling this.
 *
 * Signed rather than proxied because a proxy would mean this app streaming
 * children's photographs through its own request log. A signed URL is a short
 * lived capability that goes straight to storage and then stops working.
 *
 * Ten minutes. Long enough to read a roster, short enough that a URL copied
 * into a chat is useless by the time anybody clicks it.
 */
const TTL_SECONDS = 600;

let admin: ReturnType<typeof createClient> | null = null;

function client() {
  admin ??= createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  return admin;
}

/**
 * Sign several photo paths at once.
 *
 * A roster of eighteen children is eighteen photographs, and doing them one at
 * a time would be eighteen round trips before the page renders.
 */
export async function signPhotos(paths: (string | null | undefined)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(paths.filter((p): p is string => Boolean(p)))];
  const signed = new Map<string, string>();
  if (wanted.length === 0) return signed;

  const { data, error } = await client()
    .storage.from("child-photos")
    .createSignedUrls(wanted, TTL_SECONDS);

  // A missing photograph is not a reason for a roster to fail to load. The
  // fallback is initials, which is what the page shows for a child who never
  // uploaded one anyway.
  if (error || !data) return signed;

  for (const row of data) {
    if (row.signedUrl && row.path) signed.set(row.path, row.signedUrl);
  }
  return signed;
}

export async function signPhoto(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const map = await signPhotos([path]);
  return map.get(path) ?? null;
}
