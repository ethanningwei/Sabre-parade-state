import { Bone, ListBone } from "@/components/tg/ui";
import { isEnabled } from "@/lib/flags";

// Conducts loading: the title, the button, then the list. Static: no data.
export default function Loading() {
  if (!isEnabled("WHEREABOUTS")) return null; // flag off: not even a skeleton in the 404
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading">
      <div className="flex flex-col gap-2 px-1">
        <Bone className="h-7 w-36" />
        <Bone className="h-4 w-64" />
      </div>
      <Bone className="h-12 rounded-xl" />
      <ListBone rows={3} />
    </div>
  );
}
