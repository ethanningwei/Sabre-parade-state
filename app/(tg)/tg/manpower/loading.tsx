import { Bone, CardBone } from "@/components/tg/ui";
import { isEnabled } from "@/lib/flags";

// Manpower loading: the title, the Day/14 days switch, the date strip, the
// date line, then camp cards. Static: no data.
export default function Loading() {
  if (!isEnabled("WHEREABOUTS")) return null; // flag off: not even a skeleton in the 404
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading">
      <div className="flex flex-col gap-2 px-1">
        <Bone className="h-7 w-36" />
        <Bone className="h-4 w-48" />
      </div>
      <Bone className="h-11 rounded-xl" />
      <div className="-mx-4 flex gap-1.5 overflow-hidden px-4">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <Bone key={i} className="h-16 w-12 shrink-0 rounded-xl" />
        ))}
      </div>
      <Bone className="mx-1 -mt-1 h-4 w-52" />
      {[0, 1, 2].map((i) => (
        <CardBone key={i} />
      ))}
    </div>
  );
}
