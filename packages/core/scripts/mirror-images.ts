/**
 * Move the catalogue's pictures from one environment to another.
 *
 *   pnpm --filter @keiki/core exec tsx --env-file=../../.env.prod.local \
 *     scripts/mirror-images.ts
 *
 * Why this exists rather than "just run the import again":
 *
 * Their school logos and programme images are Airtable attachment URLs, and
 * those are signed and short lived. The ones captured on 4 September were
 * already answering 410 Gone the same evening. The local database has the
 * bytes, because the import copied them into local storage while the links were
 * still alive; a fresh import against a new project has nothing left to fetch
 * and lands twenty nine records with no picture.
 *
 * So the source of the pictures is now whichever environment already has them.
 * This reads them out of one Supabase project's public buckets and writes them
 * into another's, then repoints the rows.
 *
 * Matching is by name, not by slug or id. Slugs are derived and ids are not
 * stable across projects, but "Hanahau'oli School" is the same school in both,
 * and the catalogue import upserts on exactly that natural key.
 *
 * Safe to run twice: uploads use upsert, and a row whose picture already points
 * at the target project is left alone.
 */
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";

const SOURCE_DB = process.env.SOURCE_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
const TARGET_DB = process.env.DATABASE_URL;
const TARGET_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const TARGET_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!TARGET_DB || !TARGET_URL || !TARGET_KEY) {
  throw new Error("DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
}

const source = postgres(SOURCE_DB, { max: 2, prepare: false, onnotice: () => {} });
const target = postgres(TARGET_DB, { max: 2, prepare: false, onnotice: () => {} });
const storage = createClient(TARGET_URL, TARGET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  gif: "image/gif",
};

type Row = { name: string; url: string | null };

/**
 * The object's path inside its bucket, taken from the URL we already have.
 *
 * Deriving the slug again here would be a second implementation of a rule that
 * already ran, and the two would drift. The source URL is the answer.
 */
function objectPath(url: string, bucket: string): string | null {
  const marker = `/storage/v1/object/public/${bucket}/`;
  const at = url.indexOf(marker);
  if (at === -1) return null;
  return url.slice(at + marker.length).split("?")[0];
}

async function mirror(
  table: "programs" | "schools",
  column: "image_url" | "logo_url",
  bucket: string,
): Promise<{ copied: number; skipped: number; missing: number }> {
  const from = await source<Row[]>`
    select name, ${source(column)} as url from ${source(table)} where ${source(column)} is not null`;
  const to = await target<Row[]>`
    select name, ${target(column)} as url from ${target(table)}`;
  const wanted = new Map(to.map((r) => [r.name, r]));

  let copied = 0;
  let skipped = 0;
  let missing = 0;

  for (const row of from) {
    const here = wanted.get(row.name);
    if (!here) {
      missing++;
      continue;
    }
    if (here.url?.startsWith(`${TARGET_URL}/storage/v1/object/public/`)) {
      skipped++;
      continue;
    }

    const path = objectPath(row.url!, bucket);
    if (!path) {
      missing++;
      continue;
    }

    const res = await fetch(row.url!, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      console.log(`  ${row.name}: source answered ${res.status}`);
      missing++;
      continue;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());

    // A placeholder is not a picture. One of their programme records points at
    // a seventy byte PNG, a 1x1 transparent pixel, which copies perfectly and
    // then renders as a coloured smear across a whole card. Carrying it over
    // would be carrying a defect. See MIN_BYTES in catalogue/images.ts.
    if (bytes.byteLength < 200) {
      console.log(`  ${row.name}: only ${bytes.byteLength} bytes, dropping it rather than copying`);
      await target`update ${target(table)} set ${target(column)} = null where name = ${row.name}`;
      missing++;
      continue;
    }

    const ext = path.split(".").pop()?.toLowerCase() ?? "";

    const { error } = await storage.storage.from(bucket).upload(path, bytes, {
      upsert: true,
      contentType: CONTENT_TYPES[ext] ?? "application/octet-stream",
    });
    if (error) {
      console.log(`  ${row.name}: upload failed, ${error.message}`);
      missing++;
      continue;
    }

    // A cache buster on the public URL, for the same reason the import uses
    // one: the path is keyed on the slug, so replacing a picture reuses the
    // path and a browser would otherwise keep showing the old one forever.
    const publicUrl =
      storage.storage.from(bucket).getPublicUrl(path).data.publicUrl +
      `?v=${Date.now().toString(36)}`;
    await target`update ${target(table)} set ${target(column)} = ${publicUrl} where name = ${row.name}`;
    copied++;
  }

  return { copied, skipped, missing };
}

async function main() {
  console.log(`Mirroring pictures into ${TARGET_URL}`);
  for (const [table, column, bucket] of [
    ["programs", "image_url", "program-images"],
    ["schools", "logo_url", "school-logos"],
  ] as const) {
    const r = await mirror(table, column, bucket);
    console.log(`  ${table}: ${r.copied} copied, ${r.skipped} already there, ${r.missing} could not be copied`);
  }
  await source.end();
  await target.end();
}

main().catch(async (e) => {
  console.error(e);
  await source.end().catch(() => {});
  await target.end().catch(() => {});
  process.exit(1);
});
