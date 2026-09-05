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

/**
 * Below this, it is a placeholder rather than a photograph. A 1x1 transparent
 * PNG is seventy bytes; the smallest genuine picture in their catalogue is
 * forty kilobytes. Two hundred bytes sits in the empty space between those and
 * needs no image decoding to apply.
 */
const MIN_BYTES = 200;
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
      //
      // A dead source is stored as null rather than kept. Keeping it means
      // writing a link we have just proved is broken, and every page that shows
      // one then renders a broken image instead of the initial-letter fallback
      // it has for exactly this case. A picture we cannot get is better
      // represented by no picture than by a URL known to 410.
      //
      // Only for the permanent answers. A timeout or a 5xx is the source having
      // a bad minute, and throwing away a URL that will work again tomorrow
      // would be worse than keeping it.
      const permanentlyGone = res.status === 404 || res.status === 410 || res.status === 403;
      return {
        url: permanentlyGone ? null : sourceUrl,
        copied: false,
        problem: `source answered ${res.status}${permanentlyGone ? ", link dropped" : ""}`,
      };
    }

    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const ext = ALLOWED[type];
    if (!ext) return { url: sourceUrl, copied: false, problem: `not an image (${type})` };

    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength < MIN_BYTES) {
      // Not "empty" — a real answer that is not a real picture. One of their
      // programme records points at a seventy byte PNG, which is a 1x1
      // transparent pixel, and it copied across perfectly and then rendered as
      // a coloured smear stretched over a whole card. Worse than a broken
      // image, because nothing looks broken: it just looks badly designed.
      //
      // Treated as no picture, which is true, and the initial-letter fallback
      // every surface already has takes over.
      return {
        url: null,
        copied: false,
        problem: `only ${bytes.byteLength} bytes, not a picture`,
      };
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
