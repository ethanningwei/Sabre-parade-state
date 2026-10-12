// Pure helpers for the bot's commands, shared with the setup route. No I/O.

/** Command menus per scope (setMyCommands). Privacy mode is on, so groups only see these. */
export const PRIVATE_COMMANDS = [
  { command: "start", description: "Open Sabre" },
  { command: "sick", description: "Report sick, or record an MC or status" },
  { command: "leave", description: "Apply for annual or overseas leave" },
  { command: "off", description: "Apply for off" },
  { command: "ma", description: "Report a medical appointment" },
  { command: "event", description: "Report a course, brief, IPPT or anything else" },
  { command: "me", description: "My records" },
  { command: "whoami", description: "Your Telegram id" },
];

/** Quick commands: each is a button straight to a Mini App screen. */
export const QUICK_COMMANDS: Record<string, { text: string; buttons: { label: string; route: string }[] }> = {
  sick: {
    text: "Report sick before you go. Back from the doctor? Record what he gave you from My records. Saw a doctor without reporting sick first?",
    buttons: [
      { label: "🤒 Report sick", route: "apply/sick" },
      { label: "💊 Record an MC or status", route: "apply/outcome" },
    ],
  },
  leave: {
    text: "Which leave?",
    buttons: [
      { label: "🌴 Annual leave", route: "apply/al" },
      { label: "✈️ Overseas leave", route: "apply/ol" },
    ],
  },
  off: { text: "Apply for off:", buttons: [{ label: "🏠 Off", route: "apply/off" }] },
  ma: { text: "Report a medical appointment:", buttons: [{ label: "🏥 Appointment", route: "apply/ma" }] },
  event: { text: "Report a course, brief, IPPT or anything else:", buttons: [{ label: "📚 Event", route: "apply/event" }] },
  me: { text: "Everything you've applied for and reported:", buttons: [{ label: "📋 My records", route: "records" }] },
};
export const GROUP_COMMANDS = [
  { command: "here", description: "Link this chat to a platoon, e.g. /here PLATOON 6" },
  { command: "whoami", description: "This chat's id and topic, and yours" },
  { command: "start", description: "Open Sabre" },
];

export const ALLOWED_UPDATES = ["message", "callback_query"] as const;

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * The subunit a /here argument names. Accepts the printed name in any case
 * or spacing ("platoon 6"), a bare number or PL/PLT shorthand ("6", "PL6"),
 * and "HQ" for COY HQ.
 */
export function matchSubunit<S extends { name: string; isHq: boolean }>(arg: string, subunits: readonly S[]): S | null {
  const a = norm(arg);
  if (!a) return null;
  const exact = subunits.find((s) => norm(s.name) === a);
  if (exact) return exact;
  if (a === "HQ" || a === "COYHQ") return subunits.find((s) => s.isHq) ?? null;
  const n = /^(?:PLATOON|PLT|PL|P)?(\d+)$/.exec(a)?.[1];
  if (!n) return null;
  return subunits.find((s) => !s.isHq && new RegExp(`(?:^|[^0-9])${n}$`).test(s.name.trim())) ?? null;
}
