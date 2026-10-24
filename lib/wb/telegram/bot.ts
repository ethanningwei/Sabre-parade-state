import "server-only";
import { and, eq } from "drizzle-orm";
import { Bot, type Context, InlineKeyboard, type NextFunction } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import { db } from "@/lib/db";
import { isEnabled } from "@/lib/flags";
import { subunit } from "@/lib/db/schema";
import { linkCommanderChat } from "@/lib/wb/admin";
import type { GrantRow } from "@/lib/wb/auth";
import { recordAccess } from "@/lib/wb/domain/access";
import { actorOf } from "@/lib/wb/core";
import { decide, notRight, sayWhy, undo } from "@/lib/wb/decide";
import { wbConversation, wbGrant, wbMember } from "@/lib/wb/db/schema";
import { memberLabel, recordView } from "@/lib/wb/records";
import { markOnens } from "@/lib/wb/outcome";
import { RF_CALLBACK } from "@/lib/wb/domain/rf";
import { isWaiting, WAITING_REPLY } from "@/lib/wb/domain/roster-flow";
import { closeRf } from "@/lib/wb/rf";
import { BACK_CALLBACK } from "@/lib/wb/domain/projection-kinds";
import { confirmBack } from "@/lib/wb/projection";
import { CARD_CALLBACK, NOT_RIGHT_CALLBACK, ONENS_CALLBACK } from "./cards";
import { matchSubunit, QUICK_COMMANDS } from "./commands";
import { miniAppLink, miniAppUrl } from "./links";
import { courierOf, type Courier } from "./courier";
import type { Acting } from "@/lib/wb/write";

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
  if (!member) return void (await reply("Open Sabre and register first, then try again."));
  const chatTitle = (ctx.chat && "title" in ctx.chat ? ctx.chat.title : "") ?? "";
  const res = await linkCommanderChat(acting(member), { subunit: target, chatId: ctx.chat!.id, threadId: topic, chatTitle });
  if (!res.ok) return void (await reply(res.error));
  if (res.value === "same") return void (await reply(`This is already ${target.name}'s commanders chat.`));

  const before = res.value.replaced;
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
  // registered but not on the parade state, and no grant: nothing to open yet
  const member = ctx.from ? await memberWithGrants(ctx.from.id) : null;
  if (member && isWaiting(member)) {
    await ctx.reply(WAITING_REPLY, { message_thread_id: topicOf(ctx) ?? undefined });
    return;
  }
  if (name === "claim" && !isEnabled("CLAIMS")) {
    await ctx.reply("Transport claims aren't on in Sabre yet. Use the Form SG for now.", { message_thread_id: topicOf(ctx) ?? undefined });
    return;
  }
  const dm = ctx.chat?.type === "private";
  const kb = InlineKeyboard.from(
    q.buttons.map((b) => [dm ? InlineKeyboard.webApp(b.label, miniAppUrl(appUrl(), b.route)) : InlineKeyboard.url(b.label, miniAppLink(ctx.me.username, b.route))]),
  );
  await ctx.reply(q.text, { reply_markup: kb, message_thread_id: topicOf(ctx) ?? undefined });
}

// ------------------------------------------------------------------ cards

/** How long a "Say why" prompt waits for its reply. */
const SAY_WHY_MS = 10 * 60 * 1000;

const courierFor = (ctx: Context): Courier => courierOf({ api: ctx.api, botUsername: ctx.me.username });
const acting = (m: NonNullable<Awaited<ReturnType<typeof memberWithGrants>>>): Acting => ({ actor: actorOf(m), via: "BOT" });

/** A tap on a card: d:<recordId>:a|r|u|w. Every decision rule lives in lib/wb/decide. */
async function onCard(ctx: Context) {
  const [, recordId, act] = ctx.match as RegExpMatchArray;
  const alert = (text: string) => ctx.answerCallbackQuery({ text, show_alert: true });
  const member = ctx.from ? await memberWithGrants(ctx.from.id) : null;
  if (!member) return void (await alert("Open Sabre and register first."));

  if (act === "a" || act === "r") {
    const res = await decide(courierFor(ctx), acting(member), recordId, act === "a" ? "approve" : "reject");
    return void (await (res.ok ? ctx.answerCallbackQuery({ text: act === "a" ? "Approved" : "Rejected" }) : alert(res.error)));
  }
  if (act === "u") {
    const res = await undo(courierFor(ctx), acting(member), recordId);
    return void (await (res.ok ? ctx.answerCallbackQuery({ text: "Undone" }) : alert(res.error)));
  }

  // Say why: a prompt the decider answers by replying. Named and threaded under
  // the card, since two commanders can be writing in the same chat at once.
  if (!member.registeredAt) return void (await alert("Open Sabre and register first."));
  const r = await recordView(recordId);
  if (!r || !recordAccess(member, r).sayWhy) return void (await alert(r?.decisionNote && r.decidedBy === member.id ? "You've already said why." : "Only whoever rejected it can say why."));
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
  if (!member) return void (await ctx.answerCallbackQuery({ text: "Open Sabre and register first.", show_alert: true }));
  const res = await markOnens(courierFor(ctx), acting(member), recordId);
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

/** "❌ Not right" on the DM telling a man someone reported for him: n:<recordId>. Drops the DM's buttons once done. */
async function onNotRight(ctx: Context) {
  const [, recordId] = ctx.match as RegExpMatchArray;
  const member = ctx.from ? await memberWithGrants(ctx.from.id) : null;
  if (!member) return void (await ctx.answerCallbackQuery({ text: "Open Sabre and register first.", show_alert: true }));
  const res = await notRight(courierFor(ctx), acting(member), recordId);
  if (!res.ok) return void (await ctx.answerCallbackQuery({ text: res.error, show_alert: true }));
  await ctx.answerCallbackQuery({ text: "Taken off your records. Whoever reported it is told." });
  try {
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
  } catch (e) {
    console.error("wb not-right edit:", e);
  }
}

/** "❌ Close" on an RF card: f:<requestId>:x. Every copy is redrawn by closeRf. */
async function onRfClose(ctx: Context) {
  const [, requestId] = ctx.match as RegExpMatchArray;
  const member = ctx.from ? await memberWithGrants(ctx.from.id) : null;
  if (!member) return void (await ctx.answerCallbackQuery({ text: "Open Sabre and register first.", show_alert: true }));
  const res = await closeRf(courierFor(ctx), acting(member), requestId);
  await ctx.answerCallbackQuery(res.ok ? { text: "Closed" } : { text: res.error, show_alert: true });
}

/** "✅ … back" on the evening "Back?" message: b:<projectionId>. Drops that man's button once noted. */
async function onBack(ctx: Context) {
  const [, projectionId] = ctx.match as RegExpMatchArray;
  const member = ctx.from ? await memberWithGrants(ctx.from.id) : null;
  if (!member) return void (await ctx.answerCallbackQuery({ text: "Open Sabre and register first.", show_alert: true }));
  const res = await confirmBack(acting(member), projectionId);
  if (!res.ok) return void (await ctx.answerCallbackQuery({ text: res.error, show_alert: true }));
  const { label, closed } = res.value;
  await ctx.answerCallbackQuery({ text: closed ? `${label}: marked present` : `${label}: noted, marked present when it ends` });
  const kb = ctx.callbackQuery?.message?.reply_markup?.inline_keyboard ?? [];
  const left = kb.filter((row) => !row.some((b) => "callback_data" in b && b.callback_data === ctx.callbackQuery?.data));
  try {
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: left } });
  } catch (e) {
    console.error("wb back edit:", e);
  }
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
  const res = await sayWhy(courierFor(ctx), acting(member), c.recordId, text);
  await answer(res.ok ? `✅ Sent to ${res.value.rank} ${res.value.name}.` : res.error);
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
  safe.callbackQuery(NOT_RIGHT_CALLBACK, onNotRight);
  safe.callbackQuery(RF_CALLBACK, onRfClose);
  safe.callbackQuery(BACK_CALLBACK, onBack);
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
