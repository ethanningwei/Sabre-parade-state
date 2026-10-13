import type { InlineKeyboardButton, InlineKeyboardMarkup } from "grammy/types";
import { KIND_LABEL, recordWhat } from "@/lib/wb/domain/describe";
import { costsLeave, type WbOnens, type WbRecordKind, type WbRecordState } from "@/lib/wb/domain/rules";
import { place } from "@/lib/wb/format";
import { miniAppLink } from "./links";

// Approval cards and the trooper's DMs, as text. Pure: no I/O, so the wording
// is tested on its own. Plain text (no parse mode), so names never need escaping.
// Phase 4: an approval card carries a manning line (worked out in
// lib/wb/forecast-data.ts manningFor), passed in as text.
//
// Medical privacy: a CardRecord has no diagnosis and no photo, so nothing
// built here can carry them. An MC reads "MC 3 days · 14/10–16/10 · Respiratory".

export interface CardRecord {
  id: string;
  kind: WbRecordKind;
  state: WbRecordState;
  startAt: Date;
  endAt: Date | null;
  detail: string;
  location: string;
  reason: string;
  maTiming: string | null;
  mcCategory: string | null;
  onens: WbOnens;
  parentId: string | null;
  leaveDays: number | null;
  decisionNote: string | null;
  createdVia: "SELF" | "PROXY" | "IMPORT";
  rank: string;
  name: string;
  campName: string;
  subunitName: string;
  deciderLabel: string | null;
  /** the trooper's balance now (after the deduction, once approved) */
  ownerLeaveLeft: number | null;
}

// ------------------------------------------------------------------ callback data

/** Short and opaque, well under Telegram's 64 bytes: d:<recordId>:a|r|u|w */
export type CardAction = "a" | "r" | "u" | "w";
export const CARD_CALLBACK = /^d:([0-9a-f-]{36}):([aruw])$/;
export const cardData = (recordId: string, action: CardAction) => `d:${recordId}:${action}`;

/** "Uploaded to ONENS" on the evening reminder: o:<recordId> */
export const ONENS_CALLBACK = /^o:([0-9a-f-]{36})$/;
export const onensData = (recordId: string) => `o:${recordId}`;

// ------------------------------------------------------------------ text

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The record itself: what, who, where, when, and what it costs. */
export function recordBody(r: CardRecord): string {
  const lines = [`${KIND_LABEL[r.kind]} · ${r.rank} ${r.name}`, place(r.campName, r.subunitName), recordWhat(r)];
  if (costsLeave(r.kind) && r.leaveDays) {
    const left = r.ownerLeaveLeft;
    if (left === null) lines.push(`${plural(r.leaveDays, "day")} of leave`);
    else if (r.state === "PENDING") lines.push(`${plural(r.leaveDays, "day")} of leave · ${left} left, ${left - r.leaveDays} after this`);
    else lines.push(`${plural(r.leaveDays, "day")} of leave · ${left} left`);
  }
  if (r.kind === "AL" || r.kind === "OL") {
    lines.push([r.detail.replace(/^(AL|OL) /, ""), r.reason].filter(Boolean).join(" · "));
  }
  // his own words for his commander, as Sabre Bot showed them (agreed for Phase 3)
  if ((r.kind === "RSI" || r.kind === "RSO") && r.reason) lines.push(`Symptoms: ${r.reason}`);
  if (r.kind === "MC" || r.kind === "HL") {
    const onens = onensLine(r.onens);
    if (onens) lines.push(onens);
  }
  return lines.join("\n");
}

const HEAD: Record<WbRecordState, string> = {
  PENDING: "⏳ Approval needed",
  RECORDED: "📝 Recorded, no approval needed",
  APPROVED: "",
  REJECTED: "",
  CANCELLED: "",
  WITHDRAWN: "",
};

/** The decision line under the body. */
export function decisionLine(r: CardRecord): string {
  const by = r.deciderLabel ?? "a commander";
  switch (r.state) {
    case "APPROVED":
      return `✅ Approved by ${by}`;
    case "REJECTED":
      return `❌ Rejected by ${by}` + (r.decisionNote ? `\nWhy: ${r.decisionNote}` : "");
    case "CANCELLED":
      return `🚫 ${r.decisionNote ?? "Voided"}`;
    case "WITHDRAWN":
      return "↩️ Withdrawn";
    default:
      return "";
  }
}

/** The manning line, flagged when it's below minimum. */
export const manningText = (line: string | null | undefined) => (line ? `${line.includes("BELOW MINIMUM") ? "⚠️" : "👥"} ${line}` : "");

export function cardText(r: CardRecord, manning?: string | null): string {
  const head = HEAD[r.state];
  const foot = decisionLine(r);
  return [head, recordBody(r), manningText(manning), foot].filter(Boolean).join("\n\n");
}

export function cardKeyboard(r: CardRecord, botUsername: string): InlineKeyboardMarkup {
  const open: InlineKeyboardButton = { text: "Open", url: miniAppLink(botUsername, `records/${r.id}`) };
  const rows: InlineKeyboardButton[][] = [];
  if (r.state === "PENDING") {
    rows.push([
      { text: "✅ Approve", callback_data: cardData(r.id, "a") },
      { text: "❌ Reject", callback_data: cardData(r.id, "r") },
    ]);
  } else if (r.state === "APPROVED") {
    rows.push([{ text: "↩ Undo", callback_data: cardData(r.id, "u") }]);
  } else if (r.state === "REJECTED") {
    // Say why goes once a reason is in: it's optional and after the fact, so a
    // rejection stays one tap for a commander with fifty to get through
    const why: InlineKeyboardButton[] = r.decisionNote ? [] : [{ text: "✍️ Say why", callback_data: cardData(r.id, "w") }];
    rows.push([...why, { text: "↩ Undo", callback_data: cardData(r.id, "u") }]);
  }
  rows.push([open]);
  return { inline_keyboard: rows };
}

// ------------------------------------------------------------------ outcome cards

const onensLine = (o: WbOnens) => (o === "OWED" ? "☁️ Still to upload to ONENS" : o === "DONE" ? "☁️ Uploaded to ONENS" : "");

/** The visit an outcome hangs off (an RSI/RSO/MA), or itself when it's standalone. */
export const anchorOf = (r: { id: string; parentId: string | null }) => r.parentId ?? r.id;

/**
 * One outcome, as the commanders see it: what the doctor gave, never what
 * for. Every row of one outcome is passed together (an MC and its statuses).
 */
export function outcomeCardText(rows: readonly CardRecord[], opts: { replaces?: readonly string[] } = {}): string {
  const first = rows[0];
  const dead = rows.every((r) => r.state === "CANCELLED");
  const head = opts.replaces?.length ? "✏️ Outcome corrected" : "📝 Outcome recorded";
  const lines = [`What the doctor gave · ${first.rank} ${first.name}`, place(first.campName, first.subunitName), ...rows.map(recordWhat)];
  const onens = rows.map((r) => onensLine(r.onens)).find(Boolean);
  if (onens) lines.push(onens);
  if (rows.some((r) => r.kind === "STATUS") && !rows.some((r) => r.kind === "MC" || r.kind === "HL")) lines.push("A status keeps him present.");
  const parts = [head, lines.join("\n")];
  if (opts.replaces?.length) parts.push(`Replaces\n${opts.replaces.join("\n")}`);
  if (dead) parts.push(`🚫 ${first.decisionNote ?? "Voided"}`);
  return parts.join("\n\n");
}

export const outcomeKeyboard = (rows: readonly CardRecord[], botUsername: string): InlineKeyboardMarkup => ({
  inline_keyboard: [[{ text: "Open", url: miniAppLink(botUsername, `records/${anchorOf(rows[0])}`) }]],
});

/** A button straight to a record's outcome form (a Courier button: the Courier makes it a Mini App link). */
export const outcomeButton = (recordId: string) => [[{ text: "💊 Update outcome", route: `records/${recordId}/outcome` }]];

// ------------------------------------------------------------------ DMs to the trooper

export type Notice =
  | { kind: "decided" }
  | { kind: "undone"; by: string }
  | { kind: "why"; by: string }
  | { kind: "voided"; by: string; reason: string; refunded: number }
  | { kind: "added"; by: string }
  | { kind: "ending" }
  | { kind: "tomorrow"; rows: readonly CardRecord[] }
  | { kind: "onens"; rows: readonly CardRecord[] }
  | { kind: "chase" };

export function noticeText(r: CardRecord, n: Notice): string {
  const body = recordWhat(r);
  const balance =
    costsLeave(r.kind) && r.leaveDays && r.ownerLeaveLeft !== null ? `\n${plural(r.leaveDays, "day")} of leave · ${r.ownerLeaveLeft} left` : "";
  switch (n.kind) {
    case "decided": {
      const sick =
        (r.kind === "RSI" || r.kind === "RSO") && r.state === "APPROVED"
          ? "\n\nGo now. After you've seen the doctor, tap Update outcome and record what he gave you, even if it was nothing."
          : "";
      return `${decisionLine(r)}\n\n${body}${r.state === "APPROVED" ? balance : ""}${sick}`;
    }
    case "undone":
      return `⚠️ ${n.by} took that decision back\n\n${body}\n\nIt's with your commander again. You'll hear either way.`;
    case "why":
      return `💬 Why ${n.by} said no\n\n${body}\n\n${r.decisionNote ?? ""}`;
    case "voided":
      return (
        `🚫 ${n.by} voided this\n\n${body}\n\nWhy: ${n.reason}` +
        (n.refunded ? `\n${plural(n.refunded, "day")} of leave back · ${r.ownerLeaveLeft ?? "?"} left` : "")
      );
    case "added":
      return `📝 ${n.by} recorded this for you\n\n${body}\n\nIf it's wrong, tell them.`;
    case "ending":
      return `✅ That ends today\n\n${body}\n\nYou're back to full duty tomorrow. If the doctor extended it, record the new one in Sabre.`;
    case "tomorrow":
      return `📅 Tomorrow\n\n${n.rows.map((x) => `• ${recordWhat(x)}`).join("\n")}\n\nNothing to do. This is a reminder.`;
    case "onens":
      return `☁️ Still to do: upload to ONENS\n\n${n.rows.map((x) => `• ${recordWhat(x)}`).join("\n")}\n\nTap Uploaded once it's on ONENS.`;
    case "chase":
      return `💊 What did the doctor give you?\n\n${body}\n\nRecord the outcome, even if it was nothing, so your commanders aren't left guessing.`;
  }
}
