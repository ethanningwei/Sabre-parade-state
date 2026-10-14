import "server-only";
import { cache } from "react";
import { syncQuietly } from "@/lib/wb/projection";
import { getCoy, loadSnapshot } from "./snapshot";

// Per-request memo: the layout and the page render in parallel and both need
// these, so each is read from the database once per request.
export const currentCoy = cache(getCoy);
// With FEATURE_PROJECTION on, the whereabouts timeline is synced into the
// absences and duties first (a no-op when it's off: no queries at all).
export const currentSnapshot = cache(async () => {
  await syncQuietly();
  return loadSnapshot(await currentCoy());
});
