import { createClient } from "@supabase/supabase-js";

/**
 * Keeping a copy of their pictures.
 *
 * Their school logos and programme images are Airtable attachment URLs, and
 * Airtable attachment URLs are signed and expire. Not "eventually", either: the
 * ones captured at lunchtime were returning 410 Gone by the evening, so a
 * catalogue that links to them is a catalogue whose pictures are all broken by
 * the time anybody looks at it. That is the sort of thing that goes wrong
 * halfway through a demo.
 *
 * So the import copies them. Their endpoint stays the source of truth for what
 * the picture IS; we hold the bytes, in a public bucket, keyed on the slug so a
 * re-import overwrites rather than accumulating.
 *
 * Best effort throughout. An image that will not download is a missing picture,
 * not a failed migration, and every place that shows one already has a fallback
 * because plenty of their records have no image at all.
 */

const BUCKETS = { school: "school-logos", program: "program-images" } as const;

const MAX_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 12_000;

const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "image/gif": "gif",
};

let admin: ReturnType<typeof createClient> | null = null;

function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  admin ??= createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return admin;
}

/** Already ours? Then it is not going to expire and there is nothing to do. */
export function isOurs(url: string | null | undefined): boolean {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return Boolean(url && base && url.startsWith(`${base}/storage/v1/object/public/`));
}

export type CopyResult = { url: string | null; copied: boolean; problem?: string };

/**
 * Fetch one image and put it in our own bucket, returning a URL that will still
 * work next week.
 *
 * Returns the original URL unchanged when anything goes wrong, so a bad copy
 * never loses information we already had.
 */
export async function copyImage(
  sourceUrl: string | null | undefined,
  kind: keyof typeof BUCKETS,
  slug: string,
): Promise<CopyResult> {
  if (!sourceUrl) return { url: null, copied: false };
  if (isOurs(sourceUrl)) return { url: sourceUrl, copied: false };

  const supabase = client();
  if (!supabase) {
    return { url: sourceUrl, copied: false, problem: "no storage credentials" };
  }

  try {
    const res = await fetch(sourceUrl, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) {
      // 410 is the normal answer for an Airtable URL that has aged out, which
      // is the whole reason this function exists.
      return { url: sourceUrl, copied: false, problem: `source answered ${res.status}` };
    }

    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const ext = ALLOWED[type];
    if (!ext) return { url: sourceUrl, copied: false, problem: `not an image (${type})` };

    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength === 0) {
      return { url: sourceUrl, copied: false, problem: "empty file" };
    }
    if (bytes.byteLength > MAX_BYTES) {
      return { url: sourceUrl, copied: false, problem: "larger than 4MB" };
    }

    const bucket = BUCKETS[kind];
    const key = `${slug}.${ext}`;

    const { error } = await supabase.storage
      .from(bucket)
      .upload(key, bytes, { contentType: type, upsert: true });
    if (error) return { url: sourceUrl, copied: false, problem: error.message };

    const { data } = supabase.storage.from(bucket).getPublicUrl(key);
    return { url: data.publicUrl, copied: true };
  } catch (err) {
    return {
      url: sourceUrl,
      copied: false,
      problem: err instanceof Error ? err.message : String(err),
    };
  }
}
