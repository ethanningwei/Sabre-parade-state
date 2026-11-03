import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { ddmmyy } from "@/lib/parade/time";
import { Refusal, type Delivery } from "@/lib/wb/core";
import { wbConduct, wbConductCamp, wbConductMan } from "@/lib/wb/db/schema";
import { conductAccess, reportsFor } from "@/lib/wb/domain/access";
import { askText, canNudge, cancelledText, updatedText, type ConductInput } from "@/lib/wb/domain/conducts";
import { byRole, namedAskText } from "@/lib/wb/domain/named-list";
import { strengthGroups, strengthText, type StrengthTap } from "@/lib/wb/domain/strength-list";
import { todaySgt } from "@/lib/wb/domain/timeline";
import { campGcs, conductCoyId, namedText, waitingCamps } from "@/lib/wb/conduct-data";
import { campsInfo } from "@/lib/wb/forecast-data";
import { currentPhase } from "@/lib/wb/phase";
import type { Db } from "@/lib/wb/records";
import { strengthFor, strengthOn } from "@/lib/wb/strength-data";
import type { Courier, MessageRef } from "@/lib/wb/telegram/courier";
import { write, type Acting } from "@/lib/wb/write";

// Conducts' writes (docs/conducts-plan.md): a PS or above sets one up and
// each camp's GC is DMed; nudge and cancel. None touches the parade state.
// Vigilance only.
//   - A strength (slice 2, the user, 2026-11-02): the GC (or anyone above him)
//     sends the camp's strength, which the bot posts into Commanders of N23,
//     editing its earlier post on a second send.
//   - A named list (slice 3, the user, 2026-11-03): set-up posts the empty
//     coy list there; each camp's GC names who's going, and that one post is
//     edited to the list as it stands.

const SETUP_REFUSAL = "Only a PS or above, an ASA or an admin can set up a conduct.";

async function notInRot(tx: Db) {
  if ((await currentPhase(tx)).phase === "ROT") throw new Refusal("Conducts are for Ops Vigilance only: there's no CPT in ROT.");
}

const sendButton = (conductCampId: string, campName: string, named = false) => [
  [{ text: named ? `Name ${campName}'s men` : `Send ${campName}'s strength`, route: `conducts/camp/${conductCampId}` }],
];

type Asked = { kind: "STRENGTH" | "NAMED"; title: string; date: string; reportBy: string; team: string | null; dueDate: string | null };
const ask = (c: Asked, campName: string, nudge = false) => (c.kind === "NAMED" ? namedAskText(c, campName, nudge) : askText(c, campName, nudge));

const refOf = (r: { chatId: number | null; threadId: number | null; messageId: number | null }): MessageRef | null =>
  r.chatId !== null && r.messageId !== null ? { chatId: r.chatId, threadId: r.threadId, messageId: r.messageId } : null;

/** Set one up for the camps ticked, and DM each camp's GC. Says which camps have nobody on Sabre to ask. */
export async function setUpConduct(courier: Courier, by: Acting, input: ConductInput) {
  return write(courier, by, {
    parade: false,
    async change({ tx, audit }) {
      if (!conductAccess(by.actor).setUp) throw new Refusal(SETUP_REFUSAL);
      await notInRot(tx);
      const coyId = await conductCoyId(tx);
      if (!coyId) throw new Refusal("There's no company in Sabre yet.");
      const wanted = new Set(input.campIds);
      const camps = (await campsInfo(tx)).filter((c) => wanted.has(c.id) && !c.isHq && c.coyId === coyId);
      if (camps.length !== wanted.size) throw new Refusal("One of those camps isn't a guardroom. Reload and try again.");
      const [row] = await tx
        .insert(wbConduct)
        .values({ coyId, kind: input.kind, title: input.title, date: input.date, reportBy: input.reportBy, team: input.team, dueDate: input.dueDate, createdBy: by.actor.id })
        .returning({ id: wbConduct.id });
      const rows = await tx
        .insert(wbConductCamp)
        .values(camps.map((x) => ({ conductId: row.id, campId: x.id })))
        .returning({ id: wbConductCamp.id, campId: wbConductCamp.campId });
      const text = input.kind === "NAMED" ? await namedText(row.id, tx) : "";
      if (text) await tx.update(wbConduct).set({ text }).where(eq(wbConduct.id, row.id));
      await audit({ action: "conduct-setup", entity: "wb_conduct", entityId: row.id, after: { ...input, camps: camps.map((x) => x.name) } });
      return { id: row.id, coyId, conduct: input, text, camps: rows.map((r) => ({ id: r.id, campId: r.campId, campName: camps.find((x) => x.id === r.campId)!.name })) };
    },
    async tell(v, courier) {
      const named = v.conduct.kind === "NAMED";
      const gcs = await campGcs(v.camps.map((c) => c.campId));
      const noGc: string[] = [];
      for (const c of v.camps) {
        const mine = gcs.filter((g) => g.campId === c.campId);
        if (!mine.length) noGc.push(c.campName);
        for (const g of mine) await courier.send({ telegramId: g.telegramUserId }, ask(v.conduct, c.campName), sendButton(c.id, c.campName, named));
      }
      // a named list: the empty coy list goes up now, as the template does today
      let delivery: Delivery | null = null;
      if (named) {
        const posted = await courier.post({ coyId: v.coyId, kind: "COMMANDERS" }, v.text);
        delivery = posted.delivery;
        if (posted.ref) await db.update(wbConduct).set({ chatId: posted.ref.chatId, threadId: posted.ref.threadId, messageId: posted.ref.messageId }).where(eq(wbConduct.id, v.id));
      }
      return { id: v.id, noGc, delivery };
    },
  });
}

/**
 * A camp's strength, sent: the men are Sabre's as of now, with only the
 * sender's taps on top (a client can't make up Sabre's reasons). The bot posts
 * it into Commanders of N23, or edits its earlier post with "Updated HHMMH".
 * With no chat linked it's still saved: the screen says to copy it.
 */
export async function reportConductStrength(courier: Courier, by: Acting, input: { conductCampId: string; taps: Record<string, StrengthTap> }, now: Date = new Date()) {
  const [row] = await db.select().from(wbConductCamp).where(eq(wbConductCamp.id, input.conductCampId));
  if (!row) return { ok: false as const, error: "That conduct is gone." };
  const camp = (await campsInfo()).find((c) => c.id === row.campId);
  const found = camp ? await strengthFor(camp.id, now) : null;
  if (!camp || !found) return { ok: false as const, error: "That camp is gone." };
  const known = new Set(found.men.map((m) => m.personId));
  const taps = Object.fromEntries(Object.entries(input.taps).filter(([id]) => known.has(id)));
  const groups = strengthGroups(found.men, taps);

  return write(courier, by, {
    parade: false,
    async change({ tx, audit }) {
      if (!reportsFor(by.actor, { subunitId: camp.subunitId, campId: camp.id })) throw new Refusal(`Only ${camp.name}'s GC, or a commander above him, can send its strength.`);
      await notInRot(tx);
      const [c] = await tx.select().from(wbConductCamp).where(eq(wbConductCamp.id, row.id)).for("update");
      const [conduct] = await tx.select().from(wbConduct).where(eq(wbConduct.id, c.conductId));
      if (conduct.kind === "NAMED") throw new Refusal("This conduct is a named list. Reload and try again.");
      if (conduct.state === "CANCELLED") throw new Refusal("This conduct was cancelled.");
      if (conduct.date !== todaySgt(now)) throw new Refusal(`Strengths are sent on the day: this conduct is on ${ddmmyy(conduct.date)}.`);
      const text = strengthText({ date: conduct.date, title: conduct.title, campName: camp.name, groups });
      const lines = groups.flatMap((g) => g.lines);
      await tx.delete(wbConductMan).where(eq(wbConductMan.conductCampId, c.id));
      if (lines.length) {
        await tx.insert(wbConductMan).values(
          lines.map((l, i) => ({
            conductCampId: c.id,
            personId: l.man.personId,
            sortOrder: i,
            rank: l.man.rank,
            name: l.man.name,
            role: l.man.role,
            going: l.going,
            reason: l.reason,
            source: l.source,
          })),
        );
      }
      const going = lines.filter((l) => l.going).length;
      await tx.update(wbConductCamp).set({ going, total: lines.length, text, reportedAt: now, reportedBy: by.actor.id }).where(eq(wbConductCamp.id, c.id));
      await audit({
        action: "conduct-report",
        entity: "wb_conduct_camp",
        entityId: c.id,
        before: c.reportedAt ? { going: c.going, total: c.total } : null,
        after: { camp: camp.name, going, total: lines.length, taps: Object.keys(taps).length },
      });
      const ref = c.chatId !== null && c.messageId !== null ? { chatId: c.chatId, threadId: c.threadId, messageId: c.messageId } : null;
      return { id: c.id, coyId: conduct.coyId, text, ref, again: !!c.reportedAt };
    },
    async tell(v, courier): Promise<{ delivery: Delivery; text: string; again: boolean }> {
      if (v.ref && (await courier.editPost(v.ref, updatedText(v.text, now)))) return { delivery: "sent", text: v.text, again: v.again };
      const { delivery, ref } = await courier.post({ coyId: v.coyId, kind: "COMMANDERS" }, v.again ? updatedText(v.text, now) : v.text);
      if (ref) await db.update(wbConductCamp).set({ chatId: ref.chatId, threadId: ref.threadId, messageId: ref.messageId }).where(eq(wbConductCamp.id, v.id));
      return { delivery, text: v.text, again: v.again };
    },
  });
}

/**
 * A camp's names for a named list: the men are Sabre's (only the camp's own
 * can be named), each with why Sabre thinks he's away that day, if it does.
 * Picking him anyway is allowed: the roll-up lists him. The conduct's row is
 * locked, so two camps sending at once build the coy list one after the
 * other; the post is then edited to the newest list.
 */
export async function reportNames(courier: Courier, by: Acting, input: { conductCampId: string; personIds: readonly string[] }, now: Date = new Date()) {
  const [row] = await db
    .select({ id: wbConductCamp.id, conductId: wbConductCamp.conductId, campId: wbConductCamp.campId, date: wbConduct.date, kind: wbConduct.kind })
    .from(wbConductCamp)
    .innerJoin(wbConduct, eq(wbConduct.id, wbConductCamp.conductId))
    .where(eq(wbConductCamp.id, input.conductCampId));
  if (!row) return { ok: false as const, error: "That conduct is gone." };
  if (row.kind !== "NAMED") return { ok: false as const, error: "This conduct takes the camp's whole strength. Reload and try again." };
  const camp = (await campsInfo()).find((c) => c.id === row.campId);
  const found = camp ? await strengthOn(camp.id, row.date, now) : null;
  if (!camp || !found) return { ok: false as const, error: "That camp is gone." };
  const wanted = new Set(input.personIds);
  const picked = byRole(found.men.filter((m) => wanted.has(m.personId)));

  return write(courier, by, {
    parade: false,
    async change({ tx, audit }) {
      if (!reportsFor(by.actor, { subunitId: camp.subunitId, campId: camp.id })) throw new Refusal(`Only ${camp.name}'s GC, or a commander above him, can name its men.`);
      await notInRot(tx);
      const [conduct] = await tx.select().from(wbConduct).where(eq(wbConduct.id, row.conductId)).for("update");
      const [c] = await tx.select().from(wbConductCamp).where(eq(wbConductCamp.id, row.id));
      if (conduct.state === "CANCELLED") throw new Refusal("This conduct was cancelled.");
      if (conduct.date < todaySgt(now)) throw new Refusal(`This conduct was on ${ddmmyy(conduct.date)}. Names can't be changed now.`);
      await tx.delete(wbConductMan).where(eq(wbConductMan.conductCampId, c.id));
      if (picked.length) {
        await tx.insert(wbConductMan).values(
          picked.map((m, i) => {
            const warn = m.away ?? m.status;
            return { conductCampId: c.id, personId: m.personId, sortOrder: i, rank: m.rank, name: m.name, role: m.role, going: true, reason: warn, source: warn ? "auto" : null };
          }),
        );
      }
      await tx.update(wbConductCamp).set({ going: picked.length, total: found.men.length, text: "", reportedAt: now, reportedBy: by.actor.id }).where(eq(wbConductCamp.id, c.id));
      const text = await namedText(conduct.id, tx);
      await tx.update(wbConduct).set({ text }).where(eq(wbConduct.id, conduct.id));
      await audit({
        action: "conduct-names",
        entity: "wb_conduct_camp",
        entityId: c.id,
        before: c.reportedAt ? { named: c.going } : null,
        after: { camp: camp.name, named: picked.map((m) => `${m.rank} ${m.name}`), away: picked.filter((m) => m.away ?? m.status).length },
      });
      return { conductId: conduct.id, coyId: conduct.coyId, again: !!c.reportedAt, text };
    },
    async tell(v, courier): Promise<{ delivery: Delivery; text: string; again: boolean }> {
      // the newest list, whichever send finished last
      const [latest] = await db.select().from(wbConduct).where(eq(wbConduct.id, v.conductId));
      const text = latest?.text || v.text;
      const ref = latest ? refOf(latest) : null;
      if (ref && (await courier.editPost(ref, updatedText(text, now)))) return { delivery: "sent", text, again: v.again };
      // never posted (no chat at set-up), or the post is gone: post it, unless another send just did
      const posted = await courier.post({ coyId: v.coyId, kind: "COMMANDERS" }, ref ? updatedText(text, now) : text);
      if (posted.ref) {
        await db
          .update(wbConduct)
          .set({ chatId: posted.ref.chatId, threadId: posted.ref.threadId, messageId: posted.ref.messageId })
          .where(and(eq(wbConduct.id, v.conductId), ref ? eq(wbConduct.messageId, ref.messageId) : isNull(wbConduct.messageId)));
      }
      return { delivery: posted.delivery, text, again: v.again };
    },
  });
}

/** DM a waiting camp's GC again. Once per 10 minutes. Says how many there were to ask, and how many DMs went. */
export async function nudgeConductCamp(courier: Courier, by: Acting, conductCampId: string, now: Date = new Date()) {
  return write(courier, by, {
    parade: false,
    async change({ tx, audit }) {
      if (!conductAccess(by.actor).setUp) throw new Refusal("Only a PS or above, an ASA or an admin can nudge.");
      const [c] = await tx.select().from(wbConductCamp).where(eq(wbConductCamp.id, conductCampId)).for("update");
      if (!c) throw new Refusal("That conduct is gone.");
      const [conduct] = await tx.select().from(wbConduct).where(eq(wbConduct.id, c.conductId));
      if (conduct.state === "CANCELLED") throw new Refusal("This conduct was cancelled.");
      if (c.reportedAt) throw new Refusal(conduct.kind === "NAMED" ? "That camp has named its men." : "That camp has sent its strength.");
      if (!canNudge(c.nudgedAt, now)) throw new Refusal("Nudged in the last 10 minutes. Give him a moment.");
      await tx.update(wbConductCamp).set({ nudgedAt: now }).where(eq(wbConductCamp.id, c.id));
      const camp = (await campsInfo(tx)).find((x) => x.id === c.campId);
      await audit({ action: "conduct-nudge", entity: "wb_conduct_camp", entityId: c.id, after: { camp: camp?.name ?? null } });
      return { id: c.id, campId: c.campId, campName: camp?.name ?? "", conduct };
    },
    async tell(v, courier) {
      const gcs = await campGcs([v.campId]);
      let sent = 0;
      for (const g of gcs) sent += await courier.send({ telegramId: g.telegramUserId }, ask(v.conduct, v.campName, true), sendButton(v.id, v.campName, v.conduct.kind === "NAMED"));
      return { asked: gcs.length, sent };
    },
  });
}

/** Cancel it: the camps that haven't sent are told. */
export async function cancelConduct(courier: Courier, by: Acting, conductId: string, now: Date = new Date()) {
  return write(courier, by, {
    parade: false,
    async change({ tx, audit }) {
      if (!conductAccess(by.actor).setUp) throw new Refusal("Only a PS or above, an ASA or an admin can cancel a conduct.");
      const [c] = await tx.select().from(wbConduct).where(eq(wbConduct.id, conductId)).for("update");
      if (!c) throw new Refusal("That conduct is gone.");
      if (c.state === "CANCELLED") return { conduct: c, waiting: [] };
      await tx.update(wbConduct).set({ state: "CANCELLED", cancelledBy: by.actor.id, cancelledAt: now }).where(and(eq(wbConduct.id, c.id)));
      await audit({ action: "conduct-cancel", entity: "wb_conduct", entityId: c.id, before: { state: c.state }, after: { state: "CANCELLED" } });
      return { conduct: c, waiting: await waitingCamps(c.id, tx) };
    },
    async tell(v, courier) {
      const named = v.conduct.kind === "NAMED";
      const gcs = await campGcs(v.waiting.map((w) => w.campId));
      const what = named ? "No need to name anyone." : "No need to send the strength.";
      for (const g of gcs) await courier.send({ telegramId: g.telegramUserId }, `❌ ${ddmmyy(v.conduct.date)} ${v.conduct.title} is cancelled. ${what}`);
      // a named list's post says so too
      const ref = named ? refOf(v.conduct) : null;
      if (ref) await courier.editPost(ref, cancelledText(v.conduct.text, now));
      return gcs.length;
    },
  });
}
