import { timingSafeEqual } from "node:crypto";
import { Api } from "grammy";
import { featureOff } from "@/lib/flags";
import { eveningRound } from "@/lib/wb/evening";
import { ALLOWED_UPDATES, GROUP_COMMANDS, PRIVATE_COMMANDS } from "@/lib/wb/telegram/commands";
import { miniAppUrl } from "@/lib/wb/telegram/links";

// One-off bot setup, driven by `npm run wb:setup -- <action>`. It runs on the
// deployment so the bot token never leaves it, and is authorised by
// WB_WEBHOOK_SECRET. Nothing it returns contains the token.
//   status    bot identity, privacy mode, webhook health
//   webhook   points Telegram at /api/wb/telegram with the secret
//   menu      the chat menu button opens the Mini App
//   commands  command lists for private chats and groups
//   evening   run the evening round now (forced: even if it ran today). Vercel
//             crons only fire on production, so this is how a preview runs it
export async function POST(request: Request): Promise<Response> {
  const off = featureOff();
  if (off) return off;

  const secret = process.env.WB_WEBHOOK_SECRET;
  const got = request.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  if (!secret || got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) {
    return new Response("Forbidden", { status: 403 });
  }
  const token = process.env.WB_BOT_TOKEN;
  if (!token) return Response.json({ error: "WB_BOT_TOKEN is not set on this deployment" }, { status: 400 });
  const base = process.env.WB_APP_URL ?? `https://${new URL(request.url).host}`;

  const api = new Api(token);
  try {
    switch (new URL(request.url).searchParams.get("action") ?? "status") {
      case "webhook":
        await api.setWebhook(`${base.replace(/\/+$/, "")}/api/wb/telegram`, {
          secret_token: secret,
          allowed_updates: [...ALLOWED_UPDATES],
          drop_pending_updates: true,
        });
        break;
      case "menu":
        await api.setChatMenuButton({ menu_button: { type: "web_app", text: "Open Sabre", web_app: { url: miniAppUrl(base) } } });
        break;
      case "commands":
        await api.setMyCommands(PRIVATE_COMMANDS, { scope: { type: "all_private_chats" } });
        await api.setMyCommands(GROUP_COMMANDS, { scope: { type: "all_group_chats" } });
        break;
      case "evening": {
        const me = await api.getMe();
        return Response.json(await eveningRound({ api, botUsername: me.username }, new Date(), { force: true }));
      }
      case "status":
        break;
      default:
        return Response.json({ error: "action must be status, webhook, menu, commands or evening" }, { status: 400 });
    }
    const [me, hook, menu] = await Promise.all([api.getMe(), api.getWebhookInfo(), api.getChatMenuButton()]);
    return Response.json({
      bot: `@${me.username}`,
      privacyMode: !me.can_read_all_group_messages,
      appUrl: miniAppUrl(base),
      webhook: hook.url || null,
      pendingUpdates: hook.pending_update_count,
      lastError: hook.last_error_message ?? null,
      menuButton: menu.type === "web_app" ? menu.web_app.url : menu.type,
    });
  } catch (e) {
    // grammY errors name the method, never the token
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
