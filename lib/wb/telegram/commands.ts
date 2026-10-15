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
  { command: "hoto", description: "Log a handover (GC, PC, PS)" },
  { command: "rf", description: "RF: what's short, ask for manpower, assign Extra/RF/SOL" },
  { command: "claim", description: "Transport claim, for the OC to approve before the trip" },
  { command: "whoami", description: "Your Telegram id" },
];

/** The DM menu: /claim only while FEATURE_CLAIMS is on. */
export const privateCommands = (claims: boolean) => PRIVATE_COMMANDS.filter((c) => claims || c.command !== "claim");

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
  hoto: { text: "Log the handover when it happens:", buttons: [{ label: "🔄 HOTO", route: "hoto" }] },
  claim: {
    text: "A transport claim is asked for before the trip. The OC approves it on his sheet.",
    buttons: [
      { label: "🚕 Transport claim", route: "apply/claim" },
      { label: "📋 My claims", route: "claims" },
    ],
  },
  rf: {
    text: "Manpower: what the company is still short of, asking for more, and putting men on Extra, RF or SOL.",
    buttons: [
      { label: "🚌 RF board", route: "rf" },
      { label: "➕ Ask for manpower", route: "rf/new" },
      { label: "📌 Assign Extra/RF/SOL", route: "assign" },
    ],
  },
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
