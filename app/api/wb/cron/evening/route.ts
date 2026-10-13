import { timingSafeEqual } from "node:crypto";
import { featureOff } from "@/lib/flags";
import { eveningRound } from "@/lib/wb/evening";
import { courierOf } from "@/lib/wb/telegram/courier";
import { outbound } from "@/lib/wb/telegram/outbound";

// The evening round (vercel.json crons, 0 11 * * * UTC = 1900 SGT). Vercel
// calls it with GET and `Authorization: Bearer $CRON_SECRET`. By hand:
//   curl -H "Authorization: Bearer $CRON_SECRET" "<app>/api/wb/cron/evening?force=1"
// Once a day unless force=1. A 404 while FEATURE_WHEREABOUTS is off.
export async function GET(request: Request): Promise<Response> {
  const off = featureOff();
  if (off) return off;

  const secret = process.env.CRON_SECRET;
  const got = request.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  if (!secret || got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) {
    return new Response("Unauthorized", { status: 401 });
  }

  const force = new URL(request.url).searchParams.get("force") === "1";
  return Response.json(await eveningRound(courierOf(await outbound()), new Date(), { force }));
}
