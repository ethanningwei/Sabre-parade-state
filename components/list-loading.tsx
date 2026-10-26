import { Skeleton } from "@/components/ui/skeleton";

/** A list screen loading (Duties, History, Admin): a title, then a card of rows. */
export function ListLoading() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading">
      <div className="flex flex-col gap-2 px-1">
        <Skeleton className="h-6 w-36" />
        <Skeleton className="h-4 w-60" />
      </div>
      <div className="flex flex-col divide-y overflow-hidden rounded-2xl bg-card">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3.5">
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-4" style={{ width: `${45 + ((i * 17) % 30)}%` }} />
              <Skeleton className="h-3 w-2/5" />
            </div>
            <Skeleton className="size-4" />
          </div>
        ))}
      </div>
    </div>
  );
}
