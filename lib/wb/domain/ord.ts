// ORD: the evening round takes a man off the roster on the date he gave,
// after a send-off (status §5, 2026-10-17). Pure: the words only.

import { dayMonth } from "./timeline";

/** wb_audit action written once per member and ORD date: an admin reopening him sticks. */
export const ORD_ACTION = "ord";

export interface OrdMan {
  rank: string;
  name: string;
  /** his camp, if he's on the roster */
  campName: string | null;
  subunitName: string | null;
}

const who = (m: Pick<OrdMan, "rank" | "name">) => [m.rank, m.name].filter(Boolean).join(" ");

/** The DM. A day late (a missed round), it says when his ORD was. */
export function ordText(m: Pick<OrdMan, "rank" | "name">, ordDate: string, today: string): string {
  const when = ordDate < today ? `Your ORD was on ${dayMonth(ordDate)}` : "Today's your ORD";
  return [
    "OWADIOOOO 🎉",
    `${when}, ${who(m)}. Thank you for your service, and all the best from Sabre coy!`,
    "Your Sabre account closes tonight; your PS can reopen it if anything's left to settle.",
  ].join("\n\n");
}

const plural = (n: number) => `${n} ORD${n === 1 ? "" : "s"}`;
const at = (m: OrdMan) => (m.campName ? ` (${m.campName})` : "");

/** His platoon's digest, on the day. */
export function ordTodayLines(men: readonly OrdMan[]): string {
  if (men.length === 1) return `🎉 ORD today: ${who(men[0])}${at(men[0])}. Off the roster tonight.`;
  return [`🎉 ${plural(men.length)} today, off the roster tonight`, ...men.map((m) => `• ${who(m)}${at(m)}`)].join("\n");
}

/** COY HQ's digest, on the day: everyone, with his platoon. */
export function ordHqLines(men: readonly OrdMan[]): string {
  const where = (m: OrdMan) => {
    const p = [m.campName, m.subunitName].filter(Boolean).join(" · ");
    return p ? ` (${p})` : "";
  };
  return [`🎉 ${plural(men.length)} today, company-wide`, ...men.map((m) => `• ${who(m)}${where(m)}`)].join("\n");
}

/** His platoon's digest, the evening before: time to catch a wrong date. */
export const ordTomorrowLine = (m: OrdMan) =>
  `🎓 ORD tomorrow: ${who(m)}${at(m)}. Off the roster tomorrow evening. Wrong date? He can fix it in Sabre (My details).`;

/** To the admins: someone whose ORD came but who can't be removed automatically. */
export function ordKeptLine(m: Pick<OrdMan, "rank" | "name">, why: "bootstrap" | "last-admin"): string {
  return why === "bootstrap"
    ? `🎓 ORD today but kept: ${who(m)} is in WB_ADMIN_TELEGRAM_IDS. Take him off it, then remove him from the roster.`
    : `🎓 ORD today but kept: ${who(m)} is the last Sabre admin. Make someone else an admin; he's removed the evening after.`;
}
