import "server-only";
import { and, eq } from "drizzle-orm";
import { Bot, type Context, InlineKeyboard, type NextFunction } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import { db } from "@/lib/db";
import { subunit } from "@/lib/db/schema";
import { wbAudit } from "@/lib/wb/audit";
import { hasGrant, type GrantRow } from "@/lib/wb/auth";
import { decide, sayWhy, undo, type Actor } from "@/lib/wb/decide";
import { wbCommanderChat, wbConversation, wbGrant, wbMember } from "@/lib/wb/db/schema";
import { memberLabel, recordView } from "@/lib/wb/records";
import { markOnens } from "@/lib/wb/outcome";
import { RF_CALLBACK } from "@/lib/wb/domain/rf";
import { closeRf } from "@/lib/wb/rf";
import { CARD_CALLBACK, ONENS_CALLBACK } from "./cards";
import { matchSubunit, QUICK_COMMANDS } from "./commands";
import { miniAppLink, miniAppUrl } from "./links";
import type { Outbound } from "./outbound";

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
    await ctx.reply("Sabre takes your report sick, MC, MA, leave and off, and puts them in front of your commanders.", {
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

/** /sick, /leave, /off, /ma, /event, /me: a button straight to that screen. */
async function quick(ctx: Context) {
  const name = (ctx.msg?.text ?? "").split(/[\s@]/)[0].slice(1).toLowerCase();
  const q = QUICK_COMMANDS[name];
  if (!q) return;
  const dm = ctx.chat?.type === "private";
  const kb = InlineKeyboard.from(
    q.buttons.map((b) => [dm ? InlineKeyboard.webApp(b.label, miniAppUrl(appUrl(), b.route)) : InlineKeyboard.url(b.label, miniAppLink(ctx.me.username, b.route))]),
  );
  await ctx.reply(q.text, { reply_markup: kb, message_thread_id: topicOf(ctx) ?? undefined });
}

// ------------------------------------------------------------------ cards

/** How long a "Say why" prompt waits for its reply. */
const SAY_WHY_MS = 10 * 60 * 1000;

const outboundOf = (ctx: Context): Outbound => ({ api: ctx.api, botUsername: ctx.me.username });
const actorOf = (m: NonNullable<Awaited<ReturnType<typeof memberWithGrants>>>): Actor => ({ id: m.id, personId: m.personId, grants: m.grants });

/** A tap on a card: d:<recordId>:a|r|u|w. Every decision rule lives in lib/wb/decide. */
async function onCard(ctx: Context) {
  const [, recordId, act] = ctx.match as RegExpMatchArray;
  const alert = (text: string) => ctx.answerCallbackQuery({ text, show_alert: true });
  const member = ctx.from ? await memberWithGrants(ctx.from.id) : null;
  if (!member?.registeredAt) return void (await alert("Open Sabre and register first."));
  const actor = actorOf(member);

  if (act === "a" || act === "r") {
    const res = await decide(outboundOf(ctx), actor, recordId, act === "a" ? "approve" : "reject", "BOT");
    return void (await (res.ok ? ctx.answerCallbackQuery({ text: act === "a" ? "Approved" : "Rejected" }) : alert(res.error)));
  }
  if (act === "u") {
    const res = await undo(outboundOf(ctx), actor, recordId, "BOT");
    return void (await (res.ok ? ctx.answerCallbackQuery({ text: "Undone" }) : alert(res.error)));
  }

  // Say why: a prompt the decider answers by replying. Named and threaded under
  // the card, since two commanders can be writing in the same chat at once.
  const r = await recordView(recordId);
  if (!r || r.state !== "REJECTED" || r.decidedBy !== member.id) return void (await alert("Only whoever rejected it can say why."));
  await ctx.answerCallbackQuery();
  const card = ctx.callbackQuery?.message;
  const who = await memberLabel(member.id);
  const text = `${who}, why did you turn down ${r.rank} ${r.name}?\n\nReply to this message and I'll send it to them as you wrote it.`;
  const prompt = await ctx.reply(text, {
    // a text_mention makes force_reply "selective" pick out this commander only
    entities: [{ type: "text_mention", offset: 0, length: who.length, user: ctx.from! }],
    reply_parameters: card ? { message_id: card.message_id, allow_sending_without_reply: true } : undefined,
    message_thread_id: card && "is_topic_message" in card && card.is_topic_message ? card.message_thread_id : undefined,
    reply_markup: { force_reply: true, selective: true, input_field_placeholder: "Why not?" },
  });
  const values = {
    telegramUserId: ctx.from!.id,
    chatId: ctx.chat!.id,
    flow: "SAY_WHY",
    step: "note",
    answers: {},
    ctx: { recordId, promptMessageId: prompt.message_id },
    updatedAt: new Date(),
  };
  await db
    .insert(wbConversation)
    .values(values)
    .onConflictDoUpdate({ target: [wbConversation.telegramUserId, wbConversation.chatId], set: values });
}

/** "☁️ Uploaded" on the evening ONENS reminder: o:<recordId>. */
async function onOnens(ctx: Context) {
  const [, recordId] = ctx.match as RegExpMatchArray;
  const member = ctx.from ? await memberWithGrants(ctx.from.id) : null;
  if (!member?.registeredAt) return void (await ctx.answerCallbackQuery({ text: "Open Sabre and register first.", show_alert: true }));
  const res = await markOnens(outboundOf(ctx), actorOf(member), recordId, "BOT");
  if (!res.ok) return void (await ctx.answerCallbackQuery({ text: res.error, show_alert: true }));
  await ctx.answerCallbackQuery({ text: "Marked as uploaded" });
  // drop just this button; any other MC on the same reminder keeps its own
  const kb = ctx.callbackQuery?.message?.reply_markup?.inline_keyboard ?? [];
  const left = kb.filter((row) => !row.some((b) => "callback_data" in b && b.callback_data === ctx.callbackQuery?.data));
  try {
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: left } });
  } catch (e) {
    console.error("wb onens edit:", e);
  }
}

/** "❌ Close" on an RF card: f:<requestId>:x. Every copy is redrawn by closeRf. */
async function onRfClose(ctx: Context) {
  const [, requestId] = ctx.match as RegExpMatchArray;
  const member = ctx.from ? await memberWithGrants(ctx.from.id) : null;
  if (!member?.registeredAt) return void (await ctx.answerCallbackQuery({ text: "Open Sabre and register first.", show_alert: true }));
  const res = await closeRf(outboundOf(ctx), actorOf(member), requestId, "BOT");
  await ctx.answerCallbackQuery(res.ok ? { text: "Closed" } : { text: res.error, show_alert: true });
}

/** A reply to a "Say why" prompt. Anything else passes through untouched. */
async function onReply(ctx: Context, next: NextFunction) {
  const replyTo = ctx.msg?.reply_to_message;
  const text = ctx.msg?.text ?? "";
  if (!replyTo || !ctx.from || !ctx.chat) return next();
  const where = and(eq(wbConversation.telegramUserId, ctx.from.id), eq(wbConversation.chatId, ctx.chat.id));
  const [conv] = await db.select().from(wbConversation).where(where);
  const c = conv?.ctx as { recordId?: string; promptMessageId?: number } | undefined;
  if (!conv || conv.flow !== "SAY_WHY" || c?.promptMessageId !== replyTo.message_id || !c.recordId) return next();
  // taken, not read: a reason can't be written twice
  await db.delete(wbConversation).where(where);

  const answer = (t: string) =>
    ctx.reply(t, { reply_parameters: { message_id: ctx.msg!.message_id }, message_thread_id: topicOf(ctx) ?? undefined });
  if (Date.now() - conv.updatedAt.getTime() > SAY_WHY_MS) return void (await answer("That was more than ten minutes ago. Tap Say why on the card again."));
  if (text.startsWith("/")) return void (await answer("That looked like a command, so I dropped it. Tap Say why again."));
  const member = await memberWithGrants(ctx.from.id);
  if (!member) return;
  const res = await sayWhy(outboundOf(ctx), actorOf(member), c.recordId, text, "BOT");
  await answer(res.ok ? `✅ Sent to ${res.record.rank} ${res.record.name}.` : res.error);
}

export function createBot(token: string, botInfo?: UserFromGetMe): Bot {
  const bot = new Bot(token, { botInfo });
  // A failing handler is logged, not rethrown: a 500 makes Telegram resend the update.
  const safe = bot.errorBoundary((err) => console.error("wb bot:", err.error));
  safe.command("start", start);
  safe.command("whoami", whoami);
  safe.command("here", here);
  safe.command(Object.keys(QUICK_COMMANDS), quick);
  safe.callbackQuery(CARD_CALLBACK, onCard);
  safe.callbackQuery(ONENS_CALLBACK, onOnens);
  safe.callbackQuery(RF_CALLBACK, onRfClose);
  safe.on("message:text", onReply);
  // an old or unknown button: at least stop the spinner
  safe.on("callback_query:data", (ctx) => ctx.answerCallbackQuery());
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
