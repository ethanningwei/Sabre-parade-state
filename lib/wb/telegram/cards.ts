import type { InlineKeyboardButton, InlineKeyboardMarkup } from "grammy/types";
import { KIND_LABEL, recordWhat } from "@/lib/wb/domain/describe";
import { costsLeave, type WbRecordKind, type WbRecordState } from "@/lib/wb/domain/rules";
import { place } from "@/lib/wb/format";
import { miniAppLink } from "./links";

// Approval cards and the trooper's DMs, as text. Pure: no I/O, so the wording
// is tested on its own. Plain text (no parse mode), so names never need escaping.
// No manning impact yet: Phase 4 adds it.

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

export function cardText(r: CardRecord): string {
  const head = HEAD[r.state];
  const foot = decisionLine(r);
  return [head, recordBody(r), foot].filter(Boolean).join("\n\n");
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

// ------------------------------------------------------------------ DMs to the trooper

export type Notice =
  | { kind: "decided" }
  | { kind: "undone"; by: string }
  | { kind: "why"; by: string }
  | { kind: "voided"; by: string; reason: string; refunded: number }
  | { kind: "added"; by: string };

export function noticeText(r: CardRecord, n: Notice): string {
  const body = recordWhat(r);
  const balance =
    costsLeave(r.kind) && r.leaveDays && r.ownerLeaveLeft !== null ? `\n${plural(r.leaveDays, "day")} of leave · ${r.ownerLeaveLeft} left` : "";
  switch (n.kind) {
    case "decided":
      return `${decisionLine(r)}\n\n${body}${r.state === "APPROVED" ? balance : ""}`;
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
  }
}
