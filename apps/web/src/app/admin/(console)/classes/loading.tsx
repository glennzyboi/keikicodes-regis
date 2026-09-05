import { Skeleton } from "@/app/admin/ui";
import { ClassListSkeleton } from "./class-list";

/**
 * Arriving at Classes for the first time.
 *
 * Changing a filter once you are here is a different event and is covered by
 * the Suspense boundary inside the page, which is keyed on the filter state.
 * `loading.tsx` only ever fires on entering the route, which is why ten of
 * these existed and none of them appeared when anybody pressed a dropdown.
 *
 * Cards, because that is the default view.
 */
export default function Loading() {
  return (
    <div className="space-y-4">
      <span className="sr-only" role="status">
        Loading
      </span>
      <div aria-hidden>
        <Skeleton w={110} h={20} />
        <Skeleton w={420} h={12} className="mt-2" />
      </div>
      <div aria-hidden className="flex flex-wrap gap-2">
        {[220, 120, 140, 110, 100, 110].map((w, i) => (
          <Skeleton key={i} w={w} h={32} />
        ))}
      </div>
      <ClassListSkeleton view="cards" />
    </div>
  );
}
