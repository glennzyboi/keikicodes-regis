import { PageSkeleton } from "@/app/admin/ui";

export default function Loading() {
  return <PageSkeleton stats={4} rows={8} cols={5} />;
}
