import { timingSafeEqual } from "node:crypto";
import { webhookCallback } from "grammy";
import { featureOff } from "@/lib/flags";
import { getBot } from "@/lib/wb/telegram/bot";

// Telegram webhook for the whereabouts bot (WB_BOT_TOKEN). Telegram sends the
// secret set by `npm run wb:setup -- webhook` in X-Telegram-Bot-Api-Secret-Token.
export async function POST(request: Request): Promise<Response> {
  const off = featureOff();
  if (off) return off;

  const secret = process.env.WB_WEBHOOK_SECRET;
  const got = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!secret || got.length !== secret.length || !timingSafeEqual(Buffer.from(got), Buffer.from(secret))) {
    return new Response("Unauthorized", { status: 401 });
  }

  const handle = webhookCallback(await getBot(), "std/http");
  return handle(request);
}
