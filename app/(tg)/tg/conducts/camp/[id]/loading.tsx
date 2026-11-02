import { Bone, ListBone } from "@/components/tg/ui";
import { isEnabled } from "@/lib/flags";

// Strength list loading: the title, the conduct's name, then the men. Static: no data.
export default function Loading() {
  if (!isEnabled("WHEREABOUTS")) return null; // flag off: not even a skeleton in the 404
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading">
      <div className="flex flex-col gap-2 px-1">
        <Bone className="h-7 w-44" />
        <Bone className="h-4 w-56" />
      </div>
      <Bone className="h-12 rounded-xl" />
      <ListBone rows={6} />
    </div>
  );
}
