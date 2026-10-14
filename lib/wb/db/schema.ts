import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
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
import { absence, camp, duty, person, subunit } from "../../db/schema";
import { WB_ROLES, type WbRole } from "../domain/roles";
import { RF_ROLES, WB_ASSIGNMENT_STATES, WB_ASSIGNMENT_TYPES, WB_RF_STATES } from "../domain/rf";
import { WB_PROJECTION_CLOSES, WB_PROJECTION_KINDS } from "../domain/projection-kinds";
import { WB_SHIFT_KINDS, type WbShiftKind } from "../domain/shifts";
import { WB_ONENS, WB_RECORD_KINDS, WB_RECORD_STATES, WB_SEEN_BY, type WbRecordKind, type WbRecordState } from "../domain/rules";

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

// ---------------------------------------------------------------------------
// Phase 2: the timeline.
// ---------------------------------------------------------------------------

export { WB_RECORD_KINDS, WB_RECORD_STATES, type WbRecordKind, type WbRecordState };

export const wbRecordKind = pgEnum("wb_record_kind", WB_RECORD_KINDS);
export const wbRecordState = pgEnum("wb_record_state", WB_RECORD_STATES);
export const wbCreatedVia = pgEnum("wb_created_via", ["SELF", "PROXY", "IMPORT"]);
/** Phase 3: whether an MC still has to go up on ONENS. Only a civilian doctor's MC is ever OWED. */
export const wbOnens = pgEnum("wb_onens", WB_ONENS);
/** Phase 3: who wrote an MC that has no RSI/RSO above it to say so. */
export const wbSeenBy = pgEnum("wb_seen_by", WB_SEEN_BY);

/**
 * The timeline: one row per fact about one trooper. Ranges are half-open
 * [start_at, end_at). A date range D1..D2 is [D1 00:00 SGT, D2+1 00:00 SGT).
 *
 * person_id cascades: v1's Sheets re-import deletes and recreates every
 * person, and a RESTRICT here would make that import fail. See status §6.
 */
export const wbRecord = pgTable(
  "wb_record",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    /** who it's about, when they're a member; null for proxy entries */
    memberId: uuid("member_id").references(() => wbMember.id, { onDelete: "set null" }),
    kind: wbRecordKind("kind").notNull(),
    parentId: uuid("parent_id").references((): AnyPgColumn => wbRecord.id, { onDelete: "cascade" }),
    startAt: tstz("start_at").notNull(),
    /** null = open-ended (a permanent status, Phase 3) */
    endAt: tstz("end_at"),
    absent: boolean("absent").notNull(),
    state: wbRecordState("state").notNull(),
    decidedBy: uuid("decided_by").references(() => wbMember.id, { onDelete: "set null" }),
    decidedAt: tstz("decided_at"),
    decisionNote: text("decision_note"),
    /** AL/OL only: the days it costs */
    leaveDays: integer("leave_days"),
    /** e.g. "AL @ JOHOR BAHRU", "DV DRIVER COURSE @ MAJU CAMP" */
    detail: text("detail").default("").notNull(),
    location: text("location").default("").notNull(),
    reason: text("reason").default("").notNull(),
    /** MA only, HHMM */
    maTiming: text("ma_timing"),
    // ---- Phase 3: medical. diagnosis and evidence_file_id are read only
    // through lib/wb/medical.ts, which checks canSeeMedical and audits the read.
    /** MC/HL: one of MC_CATEGORIES, or "Other". What a card may show. */
    mcCategory: text("mc_category"),
    /** MC/HL: the doctor's words. Never on a card, never in a group chat. */
    diagnosis: text("diagnosis"),
    /** MC/HL/STATUS: the Telegram file_id of the document's photo. The photo itself stays on Telegram. */
    evidenceFileId: text("evidence_file_id"),
    onens: wbOnens("onens").default("NA").notNull(),
    /** MC/HL with no RSI/RSO above it: the camp MO or a civilian doctor */
    seenBy: wbSeenBy("seen_by"),
    /** RSI/RSO/MA: when the outcome was recorded (including "nothing given"). Stops the chase. */
    outcomeAt: tstz("outcome_at"),
    createdBy: uuid("created_by").references(() => wbMember.id, { onDelete: "set null" }),
    createdVia: wbCreatedVia("created_via").notNull(),
    createdAt: tstz("created_at").defaultNow().notNull(),
    updatedAt: tstz("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("wb_record_person_range_idx").on(t.personId, t.startAt, t.endAt),
    index("wb_record_state_idx").on(t.state),
    index("wb_record_parent_idx").on(t.parentId),
    check("wb_record_range", sql`${t.endAt} is null or ${t.endAt} > ${t.startAt}`),
  ],
);

/** One row per approval card sent, so a decision can edit every copy. */
export const wbCard = pgTable(
  "wb_card",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recordId: uuid("record_id")
      .notNull()
      .references(() => wbRecord.id, { onDelete: "cascade" }),
    chatId: tgId("chat_id").notNull(),
    threadId: tgId("thread_id"),
    messageId: integer("message_id").notNull(),
    sentAt: tstz("sent_at").defaultNow().notNull(),
  },
  (t) => [index("wb_card_record_idx").on(t.recordId)],
);

/** Bot flow state, one per user per chat. Phase 2 uses it only for "Say why". */
export const wbConversation = pgTable(
  "wb_conversation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    telegramUserId: tgId("telegram_user_id").notNull(),
    chatId: tgId("chat_id").notNull(),
    flow: text("flow").notNull(),
    step: text("step").default("").notNull(),
    answers: jsonb("answers").default({}).notNull(),
    ctx: jsonb("ctx").default({}).notNull(),
    updatedAt: tstz("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("wb_conversation_user_chat_uq").on(t.telegramUserId, t.chatId)],
);

// ---------------------------------------------------------------------------
// Phase 4: shifts and minimum manning. Nothing here writes v1 camp.on_shift:
// a HOTO only logs wb_shift_event until projection (Phase 6).
// ---------------------------------------------------------------------------

export { WB_SHIFT_KINDS, type WbShiftKind };
export const wbShiftKind = pgEnum("wb_shift_kind", WB_SHIFT_KINDS);

/**
 * How a team (a v1 camp) takes its turn. CYCLE: on_days then off_days from
 * anchor_date at hoto_time (pairs: SFT A + SFT B). WEEKLY: the weekday mask
 * (RG camps, Monday to Friday). ALWAYS: always on.
 */
export const wbShiftPattern = pgTable("wb_shift_pattern", {
  id: uuid("id").primaryKey().defaultRandom(),
  campId: uuid("camp_id")
    .notNull()
    .unique("wb_shift_pattern_camp_uq")
    .references(() => camp.id, { onDelete: "cascade" }),
  kind: wbShiftKind("kind").notNull(),
  onDays: integer("on_days").default(3).notNull(),
  offDays: integer("off_days").default(3).notNull(),
  /** CYCLE: a day this team's stint starts, at hoto_time */
  anchorDate: date("anchor_date"),
  /** HHMM */
  hotoTime: text("hoto_time").default("2100").notNull(),
  /** WEEKLY: bit 0 = Monday … bit 6 = Sunday */
  weekdayMask: integer("weekday_mask").default(31).notNull(),
  holidaysOff: boolean("holidays_off").default(true).notNull(),
  bothOnAllowed: boolean("both_on_allowed").default(false).notNull(),
  updatedBy: uuid("updated_by").references(() => wbMember.id, { onDelete: "set null" }),
  updatedAt: tstz("updated_at").defaultNow().notNull(),
});

/** Every HOTO logged: a team took over (on) or handed over, and whether the pattern agreed. */
export const wbShiftEvent = pgTable(
  "wb_shift_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campId: uuid("camp_id")
      .notNull()
      .references(() => camp.id, { onDelete: "cascade" }),
    at: tstz("at").notNull(),
    on: boolean("on").notNull(),
    by: uuid("by").references(() => wbMember.id, { onDelete: "set null" }),
    matched: boolean("matched").notNull(),
    note: text("note").default("").notNull(),
    createdAt: tstz("created_at").defaultNow().notNull(),
  },
  (t) => [index("wb_shift_event_camp_at_idx").on(t.campId, t.at)],
);

/** What a guardroom (one team) can't go under: GC:ST CBT:ST SVC, or a bare total (roles null). */
export const wbMinManning = pgTable("wb_min_manning", {
  id: uuid("id").primaryKey().defaultRandom(),
  campId: uuid("camp_id")
    .notNull()
    .unique("wb_min_manning_camp_uq")
    .references(() => camp.id, { onDelete: "cascade" }),
  total: integer("total").notNull(),
  gc: integer("gc"),
  stCbt: integer("st_cbt"),
  stSvc: integer("st_svc"),
  updatedBy: uuid("updated_by").references(() => wbMember.id, { onDelete: "set null" }),
  updatedAt: tstz("updated_at").defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Phase 5: RF requests and Extra/RF/SOL assignments. Nothing here writes v1
// duty or absence: an assignment is counted by the forecast only, until
// projection (Phase 6).
// ---------------------------------------------------------------------------

export const wbRfRole = pgEnum("wb_rf_role", RF_ROLES);
export const wbRfState = pgEnum("wb_rf_state", WB_RF_STATES);
export const wbAssignmentType = pgEnum("wb_assignment_type", WB_ASSIGNMENT_TYPES);
export const wbAssignmentState = pgEnum("wb_assignment_state", WB_ASSIGNMENT_STATES);

/** A camp saying it will be short: how many, of what, when, and why. */
export const wbRfRequest = pgTable(
  "wb_rf_request",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** where the men are needed */
    campId: uuid("camp_id")
      .notNull()
      .references(() => camp.id, { onDelete: "cascade" }),
    role: wbRfRole("role").notNull(),
    need: integer("need").notNull(),
    startAt: tstz("start_at").notNull(),
    endAt: tstz("end_at").notNull(),
    reason: text("reason").default("").notNull(),
    raisedBy: uuid("raised_by").references(() => wbMember.id, { onDelete: "set null" }),
    state: wbRfState("state").default("OPEN").notNull(),
    closedBy: uuid("closed_by").references(() => wbMember.id, { onDelete: "set null" }),
    closedAt: tstz("closed_at"),
    createdAt: tstz("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("wb_rf_request_state_idx").on(t.state, t.startAt),
    check("wb_rf_request_range", sql`${t.endAt} > ${t.startAt}`),
    check("wb_rf_request_need", sql`${t.need} > 0`),
  ],
);

/**
 * Where a man stands, when it isn't his own camp's turn as usual: Extra or RF
 * at another camp (absent at home, counted there), or SOL (leave stopped; he
 * stands with his own physical camp). It says where he stands, not that he's
 * away, so it's kept apart from wb_record (as Sabre Bot did). camp_id is his
 * own camp for SOL, as in v1's duty table.
 */
export const wbAssignment = pgTable(
  "wb_assignment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    type: wbAssignmentType("type").notNull(),
    campId: uuid("camp_id")
      .notNull()
      .references(() => camp.id, { onDelete: "cascade" }),
    startAt: tstz("start_at").notNull(),
    endAt: tstz("end_at").notNull(),
    /** the request he was sent to, if any */
    rfRequestId: uuid("rf_request_id").references(() => wbRfRequest.id, { onDelete: "set null" }),
    note: text("note").default("").notNull(),
    state: wbAssignmentState("state").default("ACTIVE").notNull(),
    createdBy: uuid("created_by").references(() => wbMember.id, { onDelete: "set null" }),
    createdAt: tstz("created_at").defaultNow().notNull(),
    cancelledBy: uuid("cancelled_by").references(() => wbMember.id, { onDelete: "set null" }),
    cancelledAt: tstz("cancelled_at"),
  },
  (t) => [
    index("wb_assignment_person_range_idx").on(t.personId, t.startAt, t.endAt),
    index("wb_assignment_request_idx").on(t.rfRequestId),
    check("wb_assignment_range", sql`${t.endAt} > ${t.startAt}`),
  ],
);

/**
 * Every copy of an RF card, so a deploy or a close can edit them all (Sabre
 * Bot kept this in memory and lost it on restart). `own` is the raiser's DM
 * copy, which has Close and no Deploy.
 */
export const wbRfCard = pgTable(
  "wb_rf_card",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rfRequestId: uuid("rf_request_id")
      .notNull()
      .references(() => wbRfRequest.id, { onDelete: "cascade" }),
    chatId: tgId("chat_id").notNull(),
    threadId: tgId("thread_id"),
    messageId: integer("message_id").notNull(),
    own: boolean("own").default(false).notNull(),
    sentAt: tstz("sent_at").defaultNow().notNull(),
  },
  (t) => [index("wb_rf_card_request_idx").on(t.rfRequestId)],
);

// ---------------------------------------------------------------- Phase 6

export const wbProjectionKind = pgEnum("wb_projection_kind", WB_PROJECTION_KINDS);
export const wbProjectionClose = pgEnum("wb_projection_close", WB_PROJECTION_CLOSES);

/**
 * Which v1 rows the projector wrote (FEATURE_PROJECTION), so it only ever
 * changes its own: an ABSENCE (from a wb_record), a DUTY (from a
 * wb_assignment) or a SHIFT (a HOTO flipping camp.on_shift). Open while the
 * projector owns the v1 row; `closed_at` + `close` say how that ended. A row
 * closed BY_HAND (a GC marked him back or ended the duty in the web app) stops
 * the projector reopening it for the same record or assignment.
 */
export const wbProjection = pgTable(
  "wb_projection",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: wbProjectionKind("kind").notNull(),
    personId: uuid("person_id").references(() => person.id, { onDelete: "cascade" }),
    recordId: uuid("record_id").references(() => wbRecord.id, { onDelete: "set null" }),
    assignmentId: uuid("assignment_id").references(() => wbAssignment.id, { onDelete: "set null" }),
    shiftEventId: uuid("shift_event_id").references(() => wbShiftEvent.id, { onDelete: "cascade" }),
    absenceId: uuid("absence_id").references(() => absence.id, { onDelete: "set null" }),
    dutyId: uuid("duty_id").references(() => duty.id, { onDelete: "set null" }),
    campId: uuid("camp_id").references(() => camp.id, { onDelete: "cascade" }),
    wroteAt: tstz("wrote_at").defaultNow().notNull(),
    updatedAt: tstz("updated_at").defaultNow().notNull(),
    closedAt: tstz("closed_at"),
    close: wbProjectionClose("close"),
    /** what the projector last wrote to the v1 row; if the row no longer says this, a GC changed it (BY_HAND) */
    wrote: jsonb("wrote"),
    /** the evening "X's MC ended. Back?" tap: the projector closes the v1 row once it has ended */
    backConfirmedAt: tstz("back_confirmed_at"),
    backConfirmedBy: uuid("back_confirmed_by").references(() => wbMember.id, { onDelete: "set null" }),
  },
  (t) => [
    index("wb_projection_record_idx").on(t.recordId),
    index("wb_projection_assignment_idx").on(t.assignmentId),
    index("wb_projection_shift_event_idx").on(t.shiftEventId),
    // one owner per v1 row
    uniqueIndex("wb_projection_absence_uq").on(t.absenceId).where(sql`${t.closedAt} is null`),
    uniqueIndex("wb_projection_duty_uq").on(t.dutyId).where(sql`${t.closedAt} is null`),
  ],
);
