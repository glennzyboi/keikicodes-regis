"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * A Supabase client for the browser, holding only the anon key.
 *
 * It exists for exactly one job: uploading a child's photograph straight to
 * storage. Everything else this app does goes through a server action or the
 * API, because the browser is not a place to put authority.
 *
 * The upload is safe to do from here because the bucket's policy does the
 * deciding, not this code. An object key is `<parent id>/<file>`, and the
 * policy says you may only write into the folder that is your own parents row.
 * A tampered key writes nowhere.
 */
let client: ReturnType<typeof createBrowserClient> | null = null;

export function supabaseBrowser() {
  client ??= createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  return client;
}
