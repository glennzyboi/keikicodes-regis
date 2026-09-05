import { PageSkeleton } from "@/app/admin/ui";

/** The overview tab, arriving. */
export default function Loading() {
  return <PageSkeleton stats={4} rows={5} cols={3} />;
}
