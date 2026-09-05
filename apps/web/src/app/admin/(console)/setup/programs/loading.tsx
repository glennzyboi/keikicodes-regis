import { PageSkeleton } from "@/app/admin/ui";

/**
 * Shown while this route streams in.
 *
 * Sized to what actually arrives, because the point of a skeleton over a
 * spinner is that the layout does not jump when the real thing lands.
 */
export default function Loading() {
  return <PageSkeleton stats={0} rows={10} cols={5} />;
}
