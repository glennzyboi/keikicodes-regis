import { PageSkeleton } from "@/app/admin/ui";

/**
 * The console's default loading state.
 *
 * Sits at the top of /admin, so any route without a loading.tsx of its own
 * still gets a skeleton rather than a blank frame while it streams in.
 */
export default function Loading() {
  return <PageSkeleton stats={4} rows={8} cols={5} />;
}
