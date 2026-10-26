import { ListBone } from "@/components/tg/ui";
import { isEnabled } from "@/lib/flags";

// Settings loading: a title and its rows. Static: no data.
export default function Loading() {
  if (!isEnabled("WHEREABOUTS")) return null; // flag off: not even a skeleton in the 404
  return <ListBone rows={4} />;
}
