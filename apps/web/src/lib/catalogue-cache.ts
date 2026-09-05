import "server-only";
import { unstable_cache } from "next/cache";
import {
  campuses,
  offeringById,
  offeringsAtSchool,
  schoolBySlug,
  sessionsFor,
  type Campus,
  type Offering,
} from "./catalogue";

/**
 * The public catalogue, cached.
 *
 * Every page was `force-dynamic` with no caching at all, so browsing to a
 * campus meant a fresh trip to Postgres for a view that joins offerings,
 * schools, programs, terms and a count of sessions per class. The answer is
 * identical for every visitor, which is the definition of something that should
 * be computed once.
 *
 * Two rules keep this honest.
 *
 * **Only genuinely public data is cached.** Nothing here reads a cookie or a
 * session, so there is no way for one family's page to be served to another.
 * Anything behind an account, meaning the console and a parent's own
 * registrations, is still rendered per request under row level security.
 *
 * **Anything that changes it invalidates it.** Every catalogue edit and every
 * schedule change calls `updateTag(CATALOGUE_TAG)`, so an office that moves a
 * class sees it moved on the public site immediately rather than being told to
 * wait. The short `revalidate` underneath is a floor, not the mechanism: it
 * exists so that a seat count is never more than half a minute stale even if a
 * write path is added later and somebody forgets to tag it.
 */
export const CATALOGUE_TAG = "catalogue";

const cacheOptions = {
  tags: [CATALOGUE_TAG],
  // Seat counts live in here. Half a minute is short enough that a parent is
  // never badly misled, and long enough that a class going viral does not turn
  // into one query per visitor. Overselling is prevented by `take_seat` in the
  // database, never by this number being small.
  revalidate: 30,
};

export const cachedCampuses = unstable_cache(
  async (): Promise<Campus[]> => campuses(),
  ["catalogue", "campuses"],
  cacheOptions,
);

export const cachedOfferingsAtSchool = unstable_cache(
  async (slug: string): Promise<Offering[]> => offeringsAtSchool(slug),
  ["catalogue", "offerings-at-school"],
  cacheOptions,
);

export const cachedSchoolBySlug = unstable_cache(
  async (slug: string) => schoolBySlug(slug),
  ["catalogue", "school-by-slug"],
  // A school's name and logo change about once a year, so this one only needs
  // the tag.
  { tags: [CATALOGUE_TAG] },
);

export const cachedOfferingById = unstable_cache(
  async (id: string): Promise<Offering | null> => offeringById(id),
  ["catalogue", "offering-by-id"],
  cacheOptions,
);

export const cachedSessionsFor = unstable_cache(
  async (offeringId: string) => sessionsFor(offeringId),
  ["catalogue", "sessions-for"],
  { tags: [CATALOGUE_TAG] },
);
