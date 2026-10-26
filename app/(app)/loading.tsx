import { Skeleton } from "@/components/ui/skeleton";

// Shown the moment a tab is tapped while the page loads (and prefetched, so
// it appears instantly). Shaped like Overview: the dial card, then subunit cards.
export default function Loading() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading">
      <div className="flex flex-col gap-4 rounded-2xl bg-card px-4 pt-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-6 w-32 rounded-full" />
        </div>
        <div className="flex items-center gap-5">
          <div className="size-33 shrink-0 rounded-full border-[14px] border-muted" />
          <div className="flex flex-1 flex-col gap-2.5">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-2">
                <Skeleton className="size-2.5 rounded-[3px]" />
                <Skeleton className="h-3.5 flex-1" />
                <Skeleton className="h-3.5 w-7" />
              </div>
            ))}
          </div>
        </div>
        <div className="-mx-4 flex min-h-14 items-center gap-3 border-t px-4 py-3">
          <Skeleton className="size-7 rounded-full" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-32" />
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="mx-1 h-3.5 w-20" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col gap-3 rounded-2xl bg-card p-4">
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-6 w-14" />
            </div>
            <Skeleton className="h-2 w-full rounded-full" />
            <Skeleton className="h-3.5 w-40" />
          </div>
        ))}
      </div>
    </div>
  );
}
