import { PageBone } from "@/components/tg/ui";
import { isEnabled } from "@/lib/flags";

// A title and some cards while this screen (or one below it) loads. Static: no data.
export default function Loading() {
  if (!isEnabled("WHEREABOUTS")) return null; // flag off: not even a skeleton in the 404
  return <PageBone cards={3} />;
}
