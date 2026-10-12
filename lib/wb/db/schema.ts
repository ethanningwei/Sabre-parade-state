import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { camp, person, subunit } from "../../db/schema";
import { WB_ROLES, type WbRole } from "../domain/roles";

// ---------------------------------------------------------------------------
// Whereabouts (FEATURE_WHEREABOUTS). Additive only: every table, enum and
// index here is prefixed wb_, and nothing in this file may change a v1 table.
// v1 tables are referenced (FKs from wb_ tables), never altered.
// Later phases add their tables here, each in its own migration.
// ---------------------------------------------------------------------------

const tstz = (name: string) => timestamp(name, { withTimezone: true });
// Telegram ids go past 2^31 but stay inside 2^52, so a JS number holds them.
const tgId = (name: string) => bigint(name, { mode: "number" });

export const wbStayout = pgEnum("wb_stayout", ["NONE", "PERM", "TEMP"]);
export const wbMemberSource = pgEnum("wb_member_source", ["ROSTER", "SELF"]);

/**
 * A Telegram identity. Created on first Mini App login; registration then
 * links it to a roster `person` (ROSTER) or records what the trooper told us
 * about himself (SELF) until an ASA puts him on the roster.
 */
export const wbMember = pgTable(
  "wb_member",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    telegramUserId: tgId("telegram_user_id").notNull().unique("wb_member_telegram_user_id_uq"),
    /** as Telegram reports it, refreshed on each login — to recognise people who haven't registered */
    tgUsername: text("tg_username"),
    tgName: text("tg_name").default("").notNull(),
    /** null until matched to the roster */
    personId: uuid("person_id").references(() => person.id, { onDelete: "set null" }),
    /** as on the NRIC, upper case */
    fullName: text("full_name"),
    /** the last 4 only, e.g. 567A — never the whole NRIC */
    nric4: text("nric4"),
    ordDate: date("ord_date"),
    leaveLeft: integer("leave_left"),
    stayout: wbStayout("stayout").default("NONE").notNull(),
    stayoutUntil: date("stayout_until"),
    source: wbMemberSource("source"),
    /** SELF sign-ups only: what they told us, for an ASA to put on the roster */
    selfName: text("self_name"),
    selfRank: text("self_rank"),
    selfRole: text("self_role"),
    selfCampId: uuid("self_camp_id").references(() => camp.id, { onDelete: "set null" }),
    /** null = signed in but not registered yet */
    registeredAt: tstz("registered_at"),
    active: boolean("active").default(true).notNull(),
    createdAt: tstz("created_at").defaultNow().notNull(),
    lastSeenAt: tstz("last_seen_at").defaultNow().notNull(),
  },
  (t) => [
    // one account per roster person
    uniqueIndex("wb_member_person_uq").on(t.personId).where(sql`${t.personId} is not null`),
  ],
);

export { WB_ROLES, type WbRole };
export const wbRole = pgEnum("wb_role", WB_ROLES);

/**
 * Who may do what. Explicit, unlike Sabre Bot where being in the chat was the
 * permission. Scope: a subunit (platoon), a camp, or neither = company-wide.
 */
export const wbGrant = pgTable(
  "wb_grant",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => wbMember.id, { onDelete: "cascade" }),
    role: wbRole("role").notNull(),
    subunitId: uuid("subunit_id").references(() => subunit.id, { onDelete: "cascade" }),
    campId: uuid("camp_id").references(() => camp.id, { onDelete: "cascade" }),
    grantedBy: uuid("granted_by").references(() => wbMember.id, { onDelete: "set null" }),
    grantedAt: tstz("granted_at").defaultNow().notNull(),
  },
  (t) => [
    check("wb_grant_one_scope", sql`${t.subunitId} is null or ${t.campId} is null`),
    // NULLS NOT DISTINCT needs Postgres 15; local dev is 14, so coalesce instead
    uniqueIndex("wb_grant_uq").on(
      t.memberId,
      t.role,
      sql`coalesce(${t.subunitId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      sql`coalesce(${t.campId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
    ),
    index("wb_grant_member_idx").on(t.memberId),
  ],
);

/** A platoon's (or COY HQ's) commanders chat, linked with /here. One per subunit. */
export const wbCommanderChat = pgTable("wb_commander_chat", {
  id: uuid("id").primaryKey().defaultRandom(),
  subunitId: uuid("subunit_id")
    .notNull()
    .unique("wb_commander_chat_subunit_uq")
    .references(() => subunit.id, { onDelete: "cascade" }),
  chatId: tgId("chat_id").notNull(),
  /** forum topic; null = the main chat */
  threadId: tgId("thread_id"),
  chatTitle: text("chat_title").default("").notNull(),
  linkedBy: uuid("linked_by").references(() => wbMember.id, { onDelete: "set null" }),
  linkedAt: tstz("linked_at").defaultNow().notNull(),
});

/** Every whereabouts change, and (from Phase 3) every read of a diagnosis or document. */
export const wbAudit = pgTable(
  "wb_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id").references(() => wbMember.id, { onDelete: "set null" }),
    /** MINIAPP | BOT | SYSTEM */
    via: text("via").notNull(),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    at: tstz("at").defaultNow().notNull(),
  },
  (t) => [index("wb_audit_at_idx").on(t.at), index("wb_audit_entity_idx").on(t.entity, t.entityId)],
);
