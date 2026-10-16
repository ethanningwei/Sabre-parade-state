"use server";

import { and, asc, count, eq, max, ne } from "drizzle-orm";
import { z } from "zod";
import { actionAdmin } from "@/lib/authz";
import { getCoy } from "@/lib/data/snapshot";
import { db } from "@/lib/db";
import { camp, coy, person, subunit } from "@/lib/db/schema";
import { savePersonCore, removePersonCore } from "@/lib/core/people";
import { isEnabled } from "@/lib/flags";
import { sendToTelegram, TelegramError } from "@/lib/telegram";
import { audit, run, UserError } from "./shared";

const id = z.string().uuid();
const name = (what: string) => z.string().trim().min(1, `${what} is required`).max(100);

function uniqueViolation(e: unknown): boolean {
  const code = (e as { code?: string; cause?: { code?: string } })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}

// ---------------------------------------------------------------- coy settings

const settingsInput = z.object({
  displayName: name("Display name"),
  telegramChatId: z
    .string()
    .trim()
    .regex(/^-?\d*$/, "Chat ID must be a number (group IDs start with -)")
    .transform((v) => v || null),
  telegramThreadId: z
    .string()
    .trim()
    .regex(/^\d*$/, "Thread ID must be a number, or blank for the main chat")
    .transform((v) => v || null),
});

export async function updateCoySettings(raw: z.input<typeof settingsInput>) {
  return run(async () => {
    const viewer = await actionAdmin();
    const input = settingsInput.parse(raw);
    const coyRow = await getCoy();
    await db.update(coy).set(input).where(eq(coy.id, coyRow.id));
    await audit(db, viewer, "update-coy", "coy", coyRow.id, coyRow, input);
    return undefined;
  });
}

export async function sendTestMessage() {
  return run(async () => {
    const viewer = await actionAdmin();
    const coyRow = await getCoy();
    if (!coyRow.telegramChatId) throw new UserError("Save a chat ID first.");
    try {
      await sendToTelegram(
        { chatId: coyRow.telegramChatId, threadId: coyRow.telegramThreadId },
        `✅ Test message from the ${coyRow.displayName} web app, sent by ${viewer.name}. Parade states will arrive here.`,
      );
    } catch (e) {
      if (e instanceof TelegramError) throw new UserError(`Telegram refused: ${e.message}`);
      throw e;
    }
    return undefined;
  });
}

// ---------------------------------------------------------------- structure

export async function createSubunit(raw: { name: string; isHq: boolean }) {
  return run(async () => {
    const viewer = await actionAdmin();
    const input = z.object({ name: name("Name"), isHq: z.boolean() }).parse(raw);
    const coyRow = await getCoy();
    if (input.isHq) {
      const [{ n }] = await db
        .select({ n: count() })
        .from(subunit)
        .where(and(eq(subunit.coyId, coyRow.id), eq(subunit.isHq, true)));
      if (n > 0) throw new UserError("This coy already has an HQ.");
    }
    const [{ last }] = await db.select({ last: max(subunit.sortOrder) }).from(subunit).where(eq(subunit.coyId, coyRow.id));
    try {
      const [row] = await db
        .insert(subunit)
        .values({ coyId: coyRow.id, name: input.name, isHq: input.isHq, sortOrder: (last ?? -1) + 1 })
        .returning();
      await audit(db, viewer, "create-subunit", "subunit", row.id, null, row);
    } catch (e) {
      if (uniqueViolation(e)) throw new UserError(`'${input.name}' already exists.`);
      throw e;
    }
    return undefined;
  });
}

export async function renameSubunit(subunitId: string, newName: string) {
  return run(async () => {
    const viewer = await actionAdmin();
    const n = name("Name").parse(newName);
    try {
      const [row] = await db.update(subunit).set({ name: n }).where(eq(subunit.id, id.parse(subunitId))).returning();
      await audit(db, viewer, "rename-subunit", "subunit", subunitId, null, { name: n });
      if (!row) throw new UserError("Not found.");
    } catch (e) {
      if (uniqueViolation(e)) throw new UserError(`'${n}' already exists.`);
      throw e;
    }
    return undefined;
  });
}

export async function deleteSubunit(subunitId: string) {
  return run(async () => {
    const viewer = await actionAdmin();
    const [{ n }] = await db.select({ n: count() }).from(camp).where(eq(camp.subunitId, id.parse(subunitId)));
    if (n > 0) throw new UserError("Move or delete its camps first.");
    await db.delete(subunit).where(eq(subunit.id, subunitId));
    await audit(db, viewer, "delete-subunit", "subunit", subunitId, null, null);
    return undefined;
  });
}

/** Swap with the neighbour above (-1) or below (+1). */
export async function moveSubunit(subunitId: string, direction: -1 | 1) {
  return run(async () => {
    await actionAdmin();
    const coyRow = await getCoy();
    const rows = await db.select().from(subunit).where(eq(subunit.coyId, coyRow.id)).orderBy(asc(subunit.sortOrder));
    const i = rows.findIndex((r) => r.id === subunitId);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= rows.length) return undefined;
    [rows[i], rows[j]] = [rows[j], rows[i]];
    await db.transaction(async (tx) => {
      for (const [k, r] of rows.entries()) await tx.update(subunit).set({ sortOrder: k }).where(eq(subunit.id, r.id));
    });
    return undefined;
  });
}

export async function createCamp(raw: { subunitId: string; name: string; post: string }) {
  return run(async () => {
    const viewer = await actionAdmin();
    const input = z.object({ subunitId: id, name: name("Camp name"), post: z.string().trim().max(100) }).parse(raw);
    const coyRow = await getCoy();
    const [s] = await db.select().from(subunit).where(eq(subunit.id, input.subunitId));
    if (!s) throw new UserError("Subunit not found.");
    if (s.isHq) {
      const [{ n }] = await db.select({ n: count() }).from(camp).where(eq(camp.subunitId, s.id));
      if (n > 0) throw new UserError("The HQ has exactly one camp.");
    }
    const [{ last }] = await db.select({ last: max(camp.sortOrder) }).from(camp).where(eq(camp.coyId, coyRow.id));
    try {
      const [row] = await db
        .insert(camp)
        .values({
          coyId: coyRow.id,
          subunitId: s.id,
          name: input.name,
          post: input.post && input.post !== input.name ? input.post : null,
          sortOrder: (last ?? -1) + 1,
        })
        .returning();
      await audit(db, viewer, "create-camp", "camp", row.id, null, row);
    } catch (e) {
      if (uniqueViolation(e)) throw new UserError(`A camp called '${input.name}' already exists. Camp names must be unique.`);
      throw e;
    }
    return undefined;
  });
}

export async function updateCamp(raw: { campId: string; name: string; subunitId: string; post: string }) {
  return run(async () => {
    const viewer = await actionAdmin();
    const input = z
      .object({ campId: id, name: name("Camp name"), subunitId: id, post: z.string().trim().max(100) })
      .parse(raw);
    const [before] = await db.select().from(camp).where(eq(camp.id, input.campId));
    if (!before) throw new UserError("Camp not found.");
    if (before.subunitId !== input.subunitId) {
      const [target] = await db.select().from(subunit).where(eq(subunit.id, input.subunitId));
      if (target?.isHq) {
        const [{ n }] = await db
          .select({ n: count() })
          .from(camp)
          .where(and(eq(camp.subunitId, target.id), ne(camp.id, before.id)));
        if (n > 0) throw new UserError("The HQ has exactly one camp.");
      }
    }
    try {
      // blank or same as the name = its own physical camp
      const post = input.post && input.post !== input.name ? input.post : null;
      await db
        .update(camp)
        .set({ name: input.name, subunitId: input.subunitId, post })
        .where(eq(camp.id, input.campId));
      await audit(db, viewer, "update-camp", "camp", input.campId, before, input);
    } catch (e) {
      if (uniqueViolation(e)) throw new UserError(`A camp called '${input.name}' already exists.`);
      throw e;
    }
    return undefined;
  });
}

export async function moveCamp(campId: string, direction: -1 | 1) {
  return run(async () => {
    await actionAdmin();
    const [c] = await db.select().from(camp).where(eq(camp.id, id.parse(campId)));
    if (!c) return undefined;
    const rows = await db.select().from(camp).where(eq(camp.subunitId, c.subunitId)).orderBy(asc(camp.sortOrder));
    const i = rows.findIndex((r) => r.id === campId);
    const j = i + direction;
    if (j < 0 || j >= rows.length) return undefined;
    // swap sort orders (global order across the coy)
    await db.transaction(async (tx) => {
      await tx.update(camp).set({ sortOrder: rows[j].sortOrder }).where(eq(camp.id, rows[i].id));
      await tx.update(camp).set({ sortOrder: rows[i].sortOrder }).where(eq(camp.id, rows[j].id));
    });
    return undefined;
  });
}

export async function deleteCamp(campId: string) {
  return run(async () => {
    const viewer = await actionAdmin();
    const [{ n }] = await db
      .select({ n: count() })
      .from(person)
      .where(and(eq(person.campId, id.parse(campId)), eq(person.active, true)));
    if (n > 0) throw new UserError("Move or remove its people first.");
    try {
      await db.transaction(async (tx) => {
        await tx.delete(person).where(eq(person.campId, campId)); // inactive history rows
        await tx.delete(camp).where(eq(camp.id, campId));
      });
    } catch (e) {
      if ((e as { code?: string })?.code === "23503" || (e as { cause?: { code?: string } })?.cause?.code === "23503") {
        throw new UserError("Someone is still serving Extra/RF/SOL at this camp. Remove them first.");
      }
      throw e;
    }
    await audit(db, viewer, "delete-camp", "camp", campId, null, null);
    return undefined;
  });
}

// ---------------------------------------------------------------- people

const personInput = z.object({
  personId: id.optional(),
  campId: id,
  rank: z.string().trim().toUpperCase().min(1, "Rank is required").max(20),
  name: z.string().trim().toUpperCase().min(1, "Name is required").max(100),
  role: z.string().trim().max(50).default(""),
});

export async function savePerson(raw: z.input<typeof personInput>) {
  return run(async () => {
    const viewer = await actionAdmin();
    const input = personInput.parse(raw);
    await savePersonCore(db, viewer.id, input);
    return undefined;
  });
}

/** Off the roster (ORD, posted out). Kept for history, never counted again. */
export async function removePerson(personId: string) {
  return run(async () => {
    const viewer = await actionAdmin();
    const pid = id.parse(personId);
    const deliver = await db.transaction(async (tx) => {
      await removePersonCore(tx, viewer.id, pid);
      // whereabouts: his grants, Telegram account, pending requests and Extra/RF/SOL go too (approved, flag-guarded)
      if (!isEnabled("WHEREABOUTS")) return null;
      const { removeFromWhereabouts } = await import("@/lib/wb/roster-flow");
      return removeFromWhereabouts(tx, pid, { v1UserId: viewer.id, v1Name: viewer.name });
    });
    await deliver?.();
    return undefined;
  });
}
