import "server-only";
import { and, eq } from "drizzle-orm";
import { Bot, type Context, InlineKeyboard } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import { db } from "@/lib/db";
import { subunit } from "@/lib/db/schema";
import { wbAudit } from "@/lib/wb/audit";
import { hasGrant, type GrantRow } from "@/lib/wb/auth";
import { wbCommanderChat, wbGrant, wbMember } from "@/lib/wb/db/schema";
import { matchSubunit } from "./commands";
import { miniAppLink, miniAppUrl } from "./links";

// The whereabouts bot (WB_BOT_TOKEN, webhook). Thin on purpose: forms live in
// the Mini App. Privacy mode stays on, so in groups it only sees commands
// addressed to it (/here@bot), which Telegram's command menu adds for you.

export function appUrl(): string {
  const url = process.env.WB_APP_URL;
  if (!url) throw new Error("WB_APP_URL is not set");
  return url;
}

const isGroup = (ctx: Context) => ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";
/** The forum topic a message was sent in, if any. */
const topicOf = (ctx: Context) => (ctx.msg?.is_topic_message ? (ctx.msg.message_thread_id ?? null) : null);

async function start(ctx: Context) {
  if (ctx.chat?.type === "private") {
    await ctx.reply("Sabre takes your report sick, MA, leave and off, and puts them in front of your commanders.", {
      reply_markup: new InlineKeyboard().webApp("Open Sabre", miniAppUrl(appUrl())),
    });
    return;
  }
  // groups can't show web_app buttons; the direct link opens the Mini App in a DM context
  await ctx.reply("Open Sabre from here:", {
    reply_markup: new InlineKeyboard().url("Open Sabre", miniAppLink(ctx.me.username)),
    message_thread_id: topicOf(ctx) ?? undefined,
  });
}

async function whoami(ctx: Context) {
  const lines = [`Chat id: ${ctx.chat?.id}`];
  const topic = topicOf(ctx);
  if (topic) lines.push(`Topic (thread) id: ${topic}`);
  lines.push(`Your Telegram id: ${ctx.from?.id}`);
  await ctx.reply(lines.join("\n"), { message_thread_id: topic ?? undefined });
}

async function memberWithGrants(telegramUserId: number) {
  const rows = await db
    .select({ m: wbMember, g: { role: wbGrant.role, subunitId: wbGrant.subunitId, campId: wbGrant.campId } })
    .from(wbMember)
    .leftJoin(wbGrant, eq(wbGrant.memberId, wbMember.id))
    .where(and(eq(wbMember.telegramUserId, telegramUserId), eq(wbMember.active, true)));
  if (!rows.length) return null;
  return { ...rows[0].m, grants: rows.flatMap((r) => (r.g?.role ? [r.g as GrantRow] : [])) };
}

/** /here PLATOON 6: this chat (or topic) becomes that platoon's commanders chat. */
async function here(ctx: Context) {
  const topic = topicOf(ctx);
  const reply = (text: string) => ctx.reply(text, { message_thread_id: topic ?? undefined });
  if (!isGroup(ctx)) return void (await reply("Send /here in the platoon's commanders chat, e.g. /here PLATOON 6."));

  const subunits = await db.select({ id: subunit.id, name: subunit.name, isHq: subunit.isHq }).from(subunit);
  const arg = typeof ctx.match === "string" ? ctx.match : "";
  const target = matchSubunit(arg, subunits);
  if (!target) {
    return void (await reply(`Which platoon? e.g. /here PLATOON 6\n\nOne of: ${subunits.map((s) => s.name).join(", ")}`));
  }

  const member = ctx.from ? await memberWithGrants(ctx.from.id) : null;
  if (!member?.registeredAt) return void (await reply("Open Sabre and register first, then try again."));
  const allowed =
    hasGrant(member.grants, ["PC", "PS"], { subunitId: target.id }) || hasGrant(member.grants, ["ADMIN"], "any");
  if (!allowed) return void (await reply(`Only ${target.name}'s PC or PS (or a Sabre admin) can link this chat.`));

  const chatId = ctx.chat!.id;
  const chatTitle = (ctx.chat && "title" in ctx.chat ? ctx.chat.title : "") ?? "";
  const [before] = await db.select().from(wbCommanderChat).where(eq(wbCommanderChat.subunitId, target.id));
  if (before && before.chatId === chatId && before.threadId === topic) {
    return void (await reply(`This is already ${target.name}'s commanders chat.`));
  }

  await db.transaction(async (tx) => {
    const values = { subunitId: target.id, chatId, threadId: topic, chatTitle, linkedBy: member.id, linkedAt: new Date() };
    const [row] = await tx
      .insert(wbCommanderChat)
      .values(values)
      .onConflictDoUpdate({ target: wbCommanderChat.subunitId, set: values })
      .returning({ id: wbCommanderChat.id });
    await wbAudit(tx, { memberId: member.id, via: "BOT", action: "link-chat", entity: "wb_commander_chat", entityId: row.id, before: before ?? null, after: values });
  });

  const where = topic ? "this topic" : "this chat";
  const displaced = before
    ? `\n\nIt replaces ${before.chatTitle || "another chat"}${before.threadId ? ` (topic ${before.threadId})` : ""}.`
    : "";
  await reply(`✅ ${target.name}'s approval cards will come to ${where}.${displaced}`);
}

export function createBot(token: string, botInfo?: UserFromGetMe): Bot {
  const bot = new Bot(token, { botInfo });
  // A failing handler is logged, not rethrown: a 500 makes Telegram resend the update.
  const safe = bot.errorBoundary((err) => console.error("wb bot:", err.error));
  safe.command("start", start);
  safe.command("whoami", whoami);
  safe.command("here", here);
  return bot;
}

// One bot per warm function. getMe runs once per cold start.
let cached: Bot | undefined;
export async function getBot(): Promise<Bot> {
  const token = process.env.WB_BOT_TOKEN;
  if (!token) throw new Error("WB_BOT_TOKEN is not set");
  if (!cached || cached.token !== token) cached = createBot(token);
  if (!cached.isInited()) await cached.init();
  return cached;
}
