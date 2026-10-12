import { notFound } from "next/navigation";

// Kill switches for everything built on top of the v1 parade-state app.
// All default to off: with no FEATURE_* set, the app is exactly v1.0.
//   WHEREABOUTS  the bot webhook, the Mini App (/tg/*), /api/wb/*, crons
//   PROJECTION   whether the timeline writes into v1 absence/duty (Phase 6)
//   CLAIMS       transport claims (Phase 7)
// Only plain Node APIs besides next/navigation, so scripts can import it too.

export type Feature = "WHEREABOUTS" | "PROJECTION" | "CLAIMS";

export function isEnabled(feature: Feature): boolean {
  return process.env[`FEATURE_${feature}`] === "1";
}

/** For layouts, pages and server actions: a 404 unless the feature is on. */
export function requireFeature(feature: Feature = "WHEREABOUTS"): void {
  if (!isEnabled(feature)) notFound();
}

/**
 * For route handlers: a plain 404 Response when the feature is off, else null.
 * Returned rather than thrown, so a handler called directly (tests, crons)
 * gives the same answer as one called over HTTP.
 */
export function featureOff(feature: Feature = "WHEREABOUTS"): Response | null {
  return isEnabled(feature) ? null : new Response("Not found", { status: 404 });
}
