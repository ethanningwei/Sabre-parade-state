import "server-only";
import { db } from "@/lib/db";
import { UserError } from "@/lib/errors";
import { wbAudit, type WbAuditEntry } from "@/lib/wb/audit";
import type { Actor, Via } from "@/lib/wb/core";
import { syncQuietly } from "@/lib/wb/projection";
import type { Db } from "@/lib/wb/records";
import type { Courier } from "@/lib/wb/telegram/courier";

// The Write: every change to whereabouts goes through here. One shape for all
// of them: an unregistered member is refused; the change runs in one
// transaction with its audit rows, and a Refusal (or v1's UserError) anywhere
// in it rolls the whole thing back with its message; once committed, the
// projector brings the parade state in line (if the write says it touches it,
// FEATURE_PROJECTION) and only then is the Courier told. A refused write says
// nothing on Telegram.

/** A member acting through the bot or the Mini App. */
export interface Acting {
  actor: Actor;
  via: Via;
}

/** The system acting: the evening round (SYSTEM) or someone in the v1 web app (WEB, named in the audit's `after.by`). */
export interface System {
  system: "SYSTEM" | "WEB";
  label?: string;
}

/** Who made a write. Fills every audit row it makes. */
export type By = Acting | System;

export type Outcome<T> = { ok: true; value: T } | { ok: false; error: string };

/** An audit row, minus who and through what: the write fills those from its By. */
export type AuditRow = Omit<WbAuditEntry, "memberId" | "via">;

export interface Change {
  tx: Db;
  audit(row: AuditRow): Promise<void>;
}

export interface WriteSpec<T, R> {
  /** Does it change what the parade state shows? Then the projector runs once it commits. */
  parade: boolean;
  /** Registration is the one write an unregistered member may make. */
  unregistered?: true;
  /** Inside the transaction. Throw Refusal to refuse. */
  change(c: Change): Promise<T>;
  /** After the commit (and the sync): cards and Audiences, through the Courier. Never on a refusal. */
  tell?(value: T, courier: Courier): Promise<R>;
}

function refusedActor(by: By, spec: { unregistered?: true }): string | null {
  if (!("actor" in by) || by.actor.registered || spec.unregistered) return null;
  return by.via === "BOT" ? "Open Sabre and register first." : "Register first.";
}

function auditFor(tx: Db, by: By) {
  return (row: AuditRow) => {
    if ("actor" in by) return wbAudit(tx, { ...row, memberId: by.actor.id, via: by.via });
    const after = by.label ? { ...((row.after as object | null | undefined) ?? {}), by: by.label } : row.after;
    return wbAudit(tx, { ...row, after, memberId: null, via: by.system });
  };
}

/** One write, in its own transaction. */
export async function write<T>(courier: null, by: By, spec: Omit<WriteSpec<T, T>, "tell">): Promise<Outcome<T>>;
export async function write<T, R = T>(courier: Courier, by: By, spec: WriteSpec<T, R>): Promise<Outcome<R>>;
export async function write<T, R>(courier: Courier | null, by: By, spec: WriteSpec<T, R>): Promise<Outcome<T | R>> {
  const refused = refusedActor(by, spec);
  if (refused) return { ok: false, error: refused };
  let value: T;
  try {
    value = await db.transaction((tx) => spec.change({ tx, audit: auditFor(tx, by) }));
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message };
    throw e;
  }
  return { ok: true, value: await after(courier, spec, value) };
}

/**
 * One write inside a transaction the caller holds (v1's Admin › Remove). A
 * refusal is thrown to the caller, whose transaction it rolls back. `finish`
 * syncs and tells: call it once the caller has committed.
 */
export async function joinWrite<T, R = T>(tx: Db, courier: () => Promise<Courier>, by: By, spec: WriteSpec<T, R>): Promise<{ value: T; finish: () => Promise<T | R> }> {
  const refused = refusedActor(by, spec);
  if (refused) throw new UserError(refused);
  const value = await spec.change({ tx, audit: auditFor(tx, by) });
  return { value, finish: async () => after(spec.tell ? await courier() : null, spec, value) };
}

async function after<T, R>(courier: Courier | null, spec: WriteSpec<T, R>, value: T): Promise<T | R> {
  if (spec.parade) await syncQuietly();
  if (!spec.tell) return value;
  if (!courier) throw new Error("write: a write that tells needs a Courier");
  return spec.tell(value, courier);
}
