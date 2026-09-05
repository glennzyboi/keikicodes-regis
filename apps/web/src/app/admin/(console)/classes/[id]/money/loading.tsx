import { PageSkeleton } from "@/app/admin/ui";

export default function Loading() {
  return <PageSkeleton stats={0} rows={8} cols={6} />;
}
