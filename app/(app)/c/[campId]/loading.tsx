import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-4 w-24" />
      <div className="flex items-end justify-between px-1">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-4 w-32" />
        </div>
        <Skeleton className="h-8 w-16" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-10 flex-1 rounded-lg" />
        <Skeleton className="h-10 w-20 rounded-lg" />
      </div>
      <div className="flex gap-2">
        {[16, 20, 20, 18].map((w, i) => (
          <Skeleton key={i} className="h-8 rounded-full" style={{ width: `${w * 4}px` }} />
        ))}
      </div>
      <div className="flex flex-col divide-y overflow-hidden rounded-2xl bg-card">
        {Array.from({ length: 9 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 px-3 py-3.5">
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-4" style={{ width: `${45 + ((i * 17) % 30)}%` }} />
              {i < 3 && <Skeleton className="h-3 w-2/5" />}
            </div>
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
