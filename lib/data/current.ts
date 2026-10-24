import "server-only";
import { cache } from "react";
import { syncQuietly } from "@/lib/wb/projection";
import { paradeView } from "@/lib/wb/rot-parade";
import { getCoy, loadSnapshot } from "./snapshot";

// Per-request memo: the layout and the page render in parallel and both need
// these, so each is read from the database once per request.
export const currentCoy = cache(getCoy);
// With FEATURE_PROJECTION on, the whereabouts timeline is synced into the
// absences and duties first (a no-op when it's off: no queries at all). In
// ROT (FEATURE_WHEREABOUTS), the snapshot is ROT's: platoons and sections,
// the Vigilance camps left out (lib/wb/rot-parade.ts; v1 exactly when off).
export const currentParade = cache(async () => {
  await syncQuietly();
  const coyRow = await currentCoy();
  return paradeView(coyRow.id, await loadSnapshot(coyRow));
});
export const currentSnapshot = cache(async () => (await currentParade()).snapshot);
