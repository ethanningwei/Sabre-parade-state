"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { actionAdmin, actionViewer } from "@/lib/authz";
import { getCoy, loadSnapshot } from "@/lib/data/snapshot";
import { db } from "@/lib/db";
import { coy, paradeState } from "@/lib/db/schema";
import { renderParadeState, validate, type Issue } from "@/lib/parade";
import { sendToTelegram, TelegramError } from "@/lib/telegram";
import { syncQuietly } from "@/lib/wb/projection";
import { audit, run, UserError } from "./shared";

const caaInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^([01]\d|2[0-3])[0-5]\d$/, "CAA time must be HHMM"),
});

export type GenerateResult = { issues: Issue[] } | { issues: []; id: string; text: string };

/** Validate everything; if clean, render and save to history. Never both. */
export async function generateParadeState(caa: { date: string; time: string }) {
  return run(async (): Promise<GenerateResult> => {
    const viewer = await actionViewer();
    const parsed = caaInput.parse(caa);
    const coyRow = await getCoy();
    await syncQuietly(); // FEATURE_PROJECTION: the timeline first; a no-op when off
    const snapshot = await loadSnapshot(coyRow);
    const issues = validate(snapshot, parsed);
    if (issues.length) return { issues };
    const text = renderParadeState(snapshot, parsed);
    const [row] = await db
      .insert(paradeState)
      .values({ coyId: coyRow.id, caaDate: parsed.date, caaTime: parsed.time, text, generatedBy: viewer.id })
      .returning({ id: paradeState.id });
    return { issues: [], id: row.id, text };
  });
}

export async function sendParadeState(paradeStateId: string) {
  return run(async () => {
    const viewer = await actionAdmin();
    z.string().uuid().parse(paradeStateId);
    const [row] = await db
      .select({ ps: paradeState, coy })
      .from(paradeState)
      .innerJoin(coy, eq(coy.id, paradeState.coyId))
      .where(eq(paradeState.id, paradeStateId));
    if (!row) throw new UserError("That parade state no longer exists.");
    if (!row.coy.telegramChatId) throw new UserError("No Telegram chat is set. Add it in Admin › Coy settings.");

    let ids: number[];
    try {
      ids = await sendToTelegram({ chatId: row.coy.telegramChatId, threadId: row.coy.telegramThreadId }, row.ps.text);
    } catch (e) {
      if (e instanceof TelegramError) throw new UserError(`Telegram refused the message: ${e.message}`);
      throw e;
    }
    await db
      .update(paradeState)
      .set({ sentAt: new Date(), sentBy: viewer.id, telegramMessageIds: ids })
      .where(eq(paradeState.id, paradeStateId));
    await audit(db, viewer, "send-parade-state", "parade_state", paradeStateId, null, { messageIds: ids });
    return { parts: ids.length };
  });
}
