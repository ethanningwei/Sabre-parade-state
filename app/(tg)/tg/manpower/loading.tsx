import { PageBone } from "@/components/tg/ui";
import { isEnabled } from "@/lib/flags";

// Manpower loading: a title and some camp cards. Static: no data.
export default function Loading() {
  if (!isEnabled("WHEREABOUTS")) return null; // flag off: not even a skeleton in the 404
  return <PageBone cards={3} />;
}
