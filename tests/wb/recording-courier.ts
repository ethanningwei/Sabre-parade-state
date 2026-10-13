import type { Audience, Button, CardKey, Courier } from "@/lib/wb/telegram/courier";

// The Courier's in-memory adapter: a core function's test asserts who was told
// and which cards moved, in domain terms, with no Telegram fake. Everything
// "goes out"; a RecordView or request view in a key is reduced to its id.

export type Sent =
  | { send: Audience; text: string; buttons?: Button[][] }
  | { postCard: { record: string } | { rf: string }; replaces?: readonly string[] }
  | { redraw: { record: string } | { rf: string } };

const idOf = (card: CardKey) =>
  "rf" in card ? { rf: typeof card.rf === "string" ? card.rf : card.rf.id } : { record: typeof card.record === "string" ? card.record : card.record.id };

export function recordingCourier(): Courier & { sent: Sent[] } {
  const sent: Sent[] = [];
  return {
    sent,
    async send(to, text, buttons) {
      sent.push(buttons ? { send: to, text, buttons } : { send: to, text });
      return 1;
    },
    async postCard(card, opts = {}) {
      sent.push(opts.replaces ? { postCard: idOf(card), replaces: opts.replaces } : { postCard: idOf(card) });
      return { delivery: "sent", chats: 1 };
    },
    async redraw(card) {
      sent.push({ redraw: idOf(card) });
    },
  };
}
