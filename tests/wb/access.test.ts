import { describe, expect, it } from "vitest";
import {
  approverOf,
  assignmentAccess,
  campAccess,
  companyOnly,
  decideRefusalText,
  inReach,
  manAccess,
  needsNoApproval,
  onlyCampScope,
  platoonAccess,
  postAccess,
  reach,
  reachLabel,
  recordAccess,
  reportAccess,
  rfAccess,
  screens,
  visitAccess,
  type GrantRow,
  type Screen,
} from "@/lib/wb/domain/access";
import type { RfRequestView } from "@/lib/wb/domain/rf";

// Who may, at the module's interface: each role at each scope against each
// question. PLATOON 6 has SLR and the SFT pair; PLATOON 5 has BDK.

const PL6 = "pl6";
const PL5 = "pl5";
const SLR = { subunitId: PL6, campId: "slr" };
const SFT_A = { subunitId: PL6, campId: "sft-a" };
const SFT_B = { subunitId: PL6, campId: "sft-b" };
const BDK = { subunitId: PL5, campId: "bdk" };
const SFT = { subunitId: PL6, teams: [{ id: "sft-a" }, { id: "sft-b" }] };

const g = (role: GrantRow["role"], scope: Partial<GrantRow> = {}): GrantRow => ({ role, subunitId: null, campId: null, ...scope });
const as = (grants: GrantRow[], personId: string | null = null, id = "m-viewer") => ({ id, personId, grants });

/** Everyone the tables below ask about, by what they hold. */
const W = {
  nobody: [],
  "GC · SLR": [g("GC", { campId: "slr" })],
  "GC · company (campless)": [g("GC")],
  "GC · PLATOON 6 (campless)": [g("GC", { subunitId: PL6 })],
  "PS · PLATOON 6": [g("PS", { subunitId: PL6 })],
  "PC · PLATOON 6": [g("PC", { subunitId: PL6 })],
  "PS · PLATOON 5": [g("PS", { subunitId: PL5 })],
  OC: [g("OC")],
  "2IC": [g("2IC")],
  CSM: [g("CSM")],
  "OC · PLATOON 5": [g("OC", { subunitId: PL5 })],
  ASA: [g("ASA")],
  "ASA · SLR": [g("ASA", { campId: "slr" })],
  ADMIN: [g("ADMIN")],
} satisfies Record<string, GrantRow[]>;
type Who = keyof typeof W;

describe("a GC's grant counts only with a camp (the user, 2026-10-21)", () => {
  it("only GC and SC are camp-only", () => {
    expect(onlyCampScope("GC")).toBe(true);
    expect(onlyCampScope("SC")).toBe(true);
    expect(["PS", "PC", "OC", "2IC", "CSM", "ASA", "ADMIN"].some((r) => onlyCampScope(r as GrantRow["role"]))).toBe(false);
  });

  it.each<Who>(["GC · company (campless)", "GC · PLATOON 6 (campless)"])("%s reaches nothing and sees no screen", (who) => {
    const v = as(W[who]);
    expect(Object.values(screens(v)).some(Boolean)).toBe(false);
    expect(manAccess(v, SLR)).toMatchObject({ sends: false, proxies: false, confirmsBack: false });
    expect(campAccess(v, SLR)).toEqual({ asks: false, forecast: false });
    expect(postAccess(v, SFT).hoto).toBe(false);
    expect(reach(v, "roster")).toEqual({ subunitIds: [], campIds: [] });
    expect(reach(v, "parade")).toEqual({ subunitIds: [], campIds: [] });
  });
});

// ------------------------------------------------------------------ screens

describe("screens", () => {
  const S: Screen[] = ["inbox", "people", "manpower", "hoto", "rf", "add", "roster", "shifts", "admin", "parade"];
  const row = (...on: Screen[]) => Object.fromEntries(S.map((s) => [s, on.includes(s)]));
  it.each<[Who, Screen[]]>([
    ["nobody", []],
    ["GC · SLR", ["manpower", "hoto", "rf", "add", "roster", "parade"]],
    ["PS · PLATOON 6", ["inbox", "people", "manpower", "hoto", "rf", "add", "roster", "shifts", "parade"]],
    ["PC · PLATOON 6", ["inbox", "people", "manpower", "hoto", "rf", "add", "roster", "shifts", "parade"]],
    ["OC", ["inbox", "people", "manpower", "hoto", "rf", "add", "roster", "parade"]],
    ["CSM", ["inbox", "people", "manpower", "hoto", "rf", "add", "roster", "parade"]],
    // company roles scoped to a platoon decide nothing, but still raise, deploy and edit the roster there
    ["OC · PLATOON 5", ["rf", "roster", "parade"]],
    ["ASA", ["rf", "roster"]],
    ["ADMIN", ["roster", "shifts", "admin", "parade"]],
  ])("%s", (who, on) => {
    expect(screens(as(W[who]))).toEqual(row(...on));
  });

  it("company only: company command with no platoon of his own", () => {
    expect(companyOnly(as(W.OC))).toBe(true);
    expect(companyOnly(as([g("OC"), g("PC", { subunitId: PL6 })]))).toBe(false);
    expect(companyOnly(as(W["PS · PLATOON 6"]))).toBe(false);
    expect(companyOnly(as(W["OC · PLATOON 5"]))).toBe(false);
  });
});

// ------------------------------------------------------------------ reach

describe("reach", () => {
  it("company-wide sees everyone, even someone with no camp", () => {
    const r = reach(as(W.OC), "roster");
    expect(r).toBe("company");
    expect(inReach(r, { subunitId: null, campId: null })).toBe(true);
    expect(reachLabel(r)).toBe("The whole company");
  });

  it("a platoon grant reaches its platoon; a camp grant its camp", () => {
    const ps = reach(as(W["PS · PLATOON 6"]), "roster");
    expect(ps).toEqual({ subunitIds: [PL6], campIds: [] });
    expect(inReach(ps, SLR)).toBe(true);
    expect(inReach(ps, BDK)).toBe(false);
    expect(inReach(ps, { subunitId: null, campId: null })).toBe(false);
    expect(reachLabel(ps)).toBe("Your platoon");
    expect(inReach(reach(as(W["ASA · SLR"]), "roster"), SLR)).toBe(true);
  });

  it("a GC reaches his own camp only", () => {
    const gc = reach(as(W["GC · SLR"]), "roster");
    expect(inReach(gc, SLR)).toBe(true);
    expect(inReach(gc, SFT_A)).toBe(false);
    expect(reachLabel(gc)).toBe("Your camp");
  });

  it("labels several", () => {
    expect(reachLabel({ subunitIds: [PL5, PL6], campIds: [] })).toBe("Your platoons and camps");
    expect(reachLabel({ subunitIds: [PL6], campIds: ["bdk"] })).toBe("Your platoons and camps");
    expect(reachLabel({ subunitIds: [], campIds: ["slr", "bdk"] })).toBe("Your camps");
  });

  it("Roster: ASAs and admins too; the parade state: not ASAs", () => {
    expect(reach(as(W.ASA), "roster")).toBe("company");
    expect(reach(as(W.ADMIN), "roster")).toBe("company");
    expect(reach(as(W.ASA), "parade")).toEqual({ subunitIds: [], campIds: [] });
    expect(reach(as(W.ADMIN), "parade")).toBe("company");
  });
});

// ------------------------------------------------------------------ a man

describe("manAccess (a man in SLR, PLATOON 6)", () => {
  type Row = [Who, { commands: boolean; sends: boolean; proxies: boolean; removes: boolean; confirmsBack: boolean }];
  it.each<Row>([
    ["nobody", { commands: false, sends: false, proxies: false, removes: false, confirmsBack: false }],
    ["GC · SLR", { commands: false, sends: true, proxies: true, removes: false, confirmsBack: true }],
    ["PS · PLATOON 6", { commands: true, sends: true, proxies: true, removes: true, confirmsBack: true }],
    ["PC · PLATOON 6", { commands: true, sends: true, proxies: true, removes: true, confirmsBack: true }],
    ["PS · PLATOON 5", { commands: false, sends: false, proxies: false, removes: false, confirmsBack: false }],
    ["OC", { commands: true, sends: true, proxies: true, removes: true, confirmsBack: true }],
    ["2IC", { commands: true, sends: true, proxies: true, removes: true, confirmsBack: true }],
    ["CSM", { commands: true, sends: true, proxies: true, removes: true, confirmsBack: true }],
    ["OC · PLATOON 5", { commands: false, sends: false, proxies: false, removes: false, confirmsBack: false }],
    ["ASA", { commands: false, sends: true, proxies: false, removes: false, confirmsBack: false }],
    ["ADMIN", { commands: false, sends: false, proxies: false, removes: true, confirmsBack: false }],
  ])("%s", (who, want) => {
    const can = manAccess(as(W[who]), { ...SLR, personId: "p-man" });
    expect(can).toMatchObject(want);
    expect(can.history).toBe(want.commands || want.removes);
  });

  it("stay-out: his platoon's PC or PS, OC/2IC/CSM and admins, himself included; not his GC (2026-10-27)", () => {
    const yes = ["PS · PLATOON 6", "PC · PLATOON 6", "OC", "2IC", "CSM", "ADMIN"] as const;
    for (const who of Object.keys(W) as Who[]) expect([who, manAccess(as(W[who]), { ...SLR, personId: "p-man" }).stayout]).toEqual([who, (yes as readonly string[]).includes(who)]);
    expect(manAccess({ personId: "p-man", grants: W["PS · PLATOON 6"] }, { ...SLR, personId: "p-man" }).stayout).toBe(true);
  });

    it("a GC's reach stops at his camp", () => {
    expect(manAccess(as(W["GC · SLR"]), SFT_A)).toMatchObject({ sends: false, proxies: false, confirmsBack: false });
  });

  it("nobody removes himself (his own sheet); by camp it's the role alone", () => {
    const ps = as(W["PS · PLATOON 6"], "p-ps");
    expect(manAccess(ps, { ...SLR, personId: "p-ps" })).toMatchObject({ removes: false, history: true });
    expect(manAccess(ps, SLR).removes).toBe(true);
    // an ADMIN alone: his own history isn't his to open
    expect(manAccess(as(W.ADMIN, "p-admin"), { ...SLR, personId: "p-admin" }).history).toBe(false);
  });
});

// ------------------------------------------------------------------ a camp, a post, a platoon

describe("campAccess", () => {
  it.each<[Who, { asks: boolean; forecast: boolean }]>([
    ["GC · SLR", { asks: true, forecast: true }],
    ["PS · PLATOON 6", { asks: true, forecast: true }],
    ["PS · PLATOON 5", { asks: false, forecast: false }],
    ["OC", { asks: true, forecast: true }],
    ["ASA", { asks: true, forecast: false }],
    ["ADMIN", { asks: false, forecast: false }],
    ["nobody", { asks: false, forecast: false }],
  ])("SLR: %s", (who, want) => {
    expect(campAccess(as(W[who]), SLR)).toEqual(want);
  });

  it("a GC's Manpower is his own camp, not the other team of a post (2026-10-16)", () => {
    expect(campAccess(as([g("GC", { campId: "sft-a" })]), SFT_B).forecast).toBe(false);
  });
});

describe("postAccess (SFT, a pair)", () => {
  it.each<[Who | "GC · SFT B", { hoto: boolean; editShifts: boolean }]>([
    ["GC · SFT B", { hoto: true, editShifts: false }],
    ["GC · SLR", { hoto: false, editShifts: false }],
    ["PS · PLATOON 6", { hoto: true, editShifts: true }],
    ["PC · PLATOON 6", { hoto: true, editShifts: true }],
    ["PS · PLATOON 5", { hoto: false, editShifts: false }],
    ["OC", { hoto: true, editShifts: false }],
    ["ASA", { hoto: false, editShifts: false }],
    ["ADMIN", { hoto: false, editShifts: true }],
  ])("%s", (who, want) => {
    const grants = who === "GC · SFT B" ? [g("GC", { campId: "sft-b" })] : W[who];
    expect(postAccess(as(grants), SFT)).toEqual(want);
  });
});

describe("platoonAccess: /here", () => {
  it("its PC or PS, a company-wide PC/PS grant, or ADMIN", () => {
    expect(platoonAccess(as(W["PS · PLATOON 6"]), PL6).linkChat).toBe(true);
    expect(platoonAccess(as(W["PS · PLATOON 5"]), PL6).linkChat).toBe(false);
    expect(platoonAccess(as(W.ADMIN), PL6).linkChat).toBe(true);
    expect(platoonAccess(as(W.OC), PL6).linkChat).toBe(false);
    expect(platoonAccess(as(W["GC · SLR"]), PL6).linkChat).toBe(false);
  });
});

// ------------------------------------------------------------------ the approval chain

describe("who decides a request (2026-10-14)", () => {
  const now = new Date("2026-08-27T10:00:00Z");
  const rec = (personId: string, ownerRoles: GrantRow["role"][]) => ({
    ...SFT_A,
    personId,
    ownerRoles,
    state: "PENDING" as const,
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
  });
  const decides = (grants: GrantRow[], personId: string | null, r: ReturnType<typeof rec>) => recordAccess(as(grants, personId), r, now).decide;

  it.each<[Who, boolean]>([
    ["PS · PLATOON 6", true],
    ["PC · PLATOON 6", true],
    ["PS · PLATOON 5", false],
    ["OC", true],
    ["2IC", true],
    ["CSM", true],
    ["OC · PLATOON 5", false],
    ["GC · SLR", false],
    ["ASA", false],
    ["ADMIN", false],
    ["nobody", false],
  ])("a trooper's: %s → %s", (who, want) => {
    expect(decides(W[who], null, rec("t", []))).toBe(want);
    expect(decides(W[who], null, rec("t", ["GC"]))).toBe(want);
  });

  it("a PS's: the PC or company HQ, never another PS", () => {
    expect(decides(W["PS · PLATOON 6"], "ps2", rec("ps", ["PS"]))).toBe(false);
    expect(decides(W["PC · PLATOON 6"], "pc", rec("ps", ["PS"]))).toBe(true);
    expect(decides(W.CSM, "csm", rec("ps", ["PS"]))).toBe(true);
  });

  it("a PC's: OC, 2IC or CSM only", () => {
    expect(decides(W["PS · PLATOON 6"], "ps", rec("pc", ["PC"]))).toBe(false);
    expect(decides(W["PC · PLATOON 6"], "pc2", rec("pc", ["PC"]))).toBe(false);
    expect(decides(W.CSM, "csm", rec("pc", ["PC"]))).toBe(true);
    expect(decides(W.OC, "oc", rec("pc", ["PC"]))).toBe(true);
  });

  it("nobody decides their own, except an ADMIN who commands there", () => {
    expect(decides(W["PS · PLATOON 6"], "ps", rec("ps", ["PS"]))).toBe(false);
    expect(decides(W.OC, "oc", rec("oc", ["OC"]))).toBe(false);
    expect(decides([...W["PS · PLATOON 6"], g("ADMIN")], "ps", rec("ps", ["PS", "ADMIN"]))).toBe(true);
    expect(decides(W.ADMIN, "t", rec("t", ["ADMIN"]))).toBe(false);
  });

  it("approves is the chain whatever the state; decide only while pending", () => {
    const pc = recordAccess(as(W["PC · PLATOON 6"], "pc"), { ...rec("t", []), state: "APPROVED" }, now);
    expect(pc).toMatchObject({ approves: true, decide: false });
  });

  it("OC, 2IC and CSM need no approval; the others are told who approves", () => {
    expect(needsNoApproval(as(W["2IC"]))).toBe(true);
    expect(needsNoApproval(as(W["OC · PLATOON 5"]))).toBe(true);
    expect(needsNoApproval(as(W["PC · PLATOON 6"]))).toBe(false);
    expect(approverOf([])).toBe("your PC or PS");
    expect(approverOf(["GC"])).toBe("your PC or PS");
    expect(approverOf(["PS"])).toBe("your PC, OC, 2IC or CSM");
    expect(approverOf(["PC"])).toBe("OC, 2IC or CSM");
    expect(approverOf(["CSM"])).toBeNull();
  });

  it("the refusal says why", () => {
    expect(decideRefusalText({ personId: "ps" }, { ...rec("ps", ["PS"]), subunitName: "PLATOON 6" })).toMatch(/your own/);
    expect(decideRefusalText({ personId: "ps" }, { ...rec("pc", ["PC"]), subunitName: "PLATOON 6" })).toBe("Only OC, 2IC or CSM can decide this.");
    expect(decideRefusalText({ personId: "x" }, { ...rec("ps", ["PS"]), subunitName: "PLATOON 6" })).toMatch(/PLATOON 6's PC/);
    expect(decideRefusalText({ personId: "x" }, { ...rec("t", []), subunitName: "PLATOON 6" })).toBe("Only PLATOON 6's PC or PS can decide this.");
  });
});

// ------------------------------------------------------------------ a record

describe("recordAccess", () => {
  const now = new Date("2026-08-27T10:00:00Z");
  const rec = { ...SFT_A, personId: "p1", ownerRoles: [], state: "PENDING" as const, decidedBy: null, decidedAt: null, decisionNote: null };
  const trooper = as([], "p1", "m1");
  const ps = as(W["PS · PLATOON 6"], "p2", "m2");
  const gc = as([g("GC", { campId: "sft-a" })], "p3", "m3");
  const rejected = { ...rec, state: "REJECTED" as const, decidedBy: "m2", decidedAt: new Date(now.getTime() - 1000) };

  it("the trooper sees and withdraws his own pending request; the PS decides it; his GC sees nothing", () => {
    expect(recordAccess(trooper, rec, now)).toEqual({
      commands: false, approves: false, view: true, decide: false, undo: false, sayWhy: false, void: false, withdraw: true, notRight: false, markOnens: true, seeMedical: true,
    });
    expect(recordAccess(ps, rec, now)).toEqual({
      commands: true, approves: true, view: true, decide: true, undo: false, sayWhy: false, void: false, withdraw: false, notRight: false, markOnens: true, seeMedical: true,
    });
    expect(recordAccess(gc, rec, now)).toMatchObject({ view: false, decide: false, void: false, seeMedical: false, markOnens: false });
  });

  it("a report made for him (2026-10-24): Not right instead of Withdraw, for him only, while it's pending or stands", () => {
    const reported = { ...rec, kind: "RSO" as const, createdVia: "PROXY" };
    expect(recordAccess(trooper, reported, now)).toMatchObject({ withdraw: false, notRight: true });
    expect(recordAccess(trooper, { ...reported, state: "APPROVED", decidedBy: "m2", decidedAt: now }, now).notRight).toBe(true);
    expect(recordAccess(trooper, { ...reported, kind: "MA", state: "RECORDED" }, now).notRight).toBe(true);
    expect(recordAccess(trooper, { ...reported, state: "CANCELLED" }, now).notRight).toBe(false);
    expect(recordAccess(ps, reported, now).notRight).toBe(false);
    // his own report sick, or an event added for him: no Not right
    expect(recordAccess(trooper, { ...reported, createdVia: "SELF" }, now)).toMatchObject({ withdraw: true, notRight: false });
    expect(recordAccess(trooper, { ...reported, kind: "EVENT", state: "RECORDED" }, now).notRight).toBe(false);
    // the GC who reported it may open it, not decide it or see its medical side; another GC can't
    expect(recordAccess(gc, { ...reported, createdBy: "m3" }, now)).toMatchObject({ view: true, decide: false, seeMedical: false, notRight: false });
    expect(recordAccess(gc, { ...reported, createdBy: "m-other" }, now).view).toBe(false);
  });

  it("a PS sees his own pending request but can't decide it", () => {
    expect(recordAccess(ps, { ...rec, personId: "p2", ownerRoles: ["PS"] }, now)).toMatchObject({ view: true, decide: false, withdraw: true });
  });

  it("after a rejection the decider may undo, and say why once: never over a reason already given (2026-10-21)", () => {
    expect(recordAccess(ps, rejected, now)).toMatchObject({ undo: true, sayWhy: true, void: false, decide: false });
    expect(recordAccess(ps, { ...rejected, decisionNote: "short" }, now).sayWhy).toBe(false);
    expect(recordAccess(as(W["PC · PLATOON 6"], null, "m9"), rejected, now).sayWhy).toBe(false);
  });

  it("undo: the decider, still commanding there, within the window, and not once there's an outcome", () => {
    const approved = { ...rejected, state: "APPROVED" as const };
    expect(recordAccess(ps, approved, now)).toMatchObject({ undo: true, void: true });
    expect(recordAccess(ps, { ...approved, hasOutcome: true }, now)).toMatchObject({ undo: false, void: true });
    expect(recordAccess(as(W["PS · PLATOON 5"], null, "m2"), approved, now).undo).toBe(false);
    expect(recordAccess(ps, approved, new Date(now.getTime() + 11 * 60_000)).undo).toBe(false);
  });

  it.each<[string, { personId: string | null; grants: GrantRow[] }, boolean]>([
    ["the trooper", { personId: "p1", grants: [] }, true],
    ["his PS", { personId: "ps", grants: W["PS · PLATOON 6"] }, true],
    ["his PC", { personId: null, grants: W["PC · PLATOON 6"] }, true],
    ["OC", { personId: null, grants: W.OC }, true],
    ["2IC", { personId: null, grants: W["2IC"] }, true],
    ["CSM", { personId: null, grants: W.CSM }, true],
    ["another platoon's PS", { personId: null, grants: W["PS · PLATOON 5"] }, false],
    ["his camp's GC", { personId: null, grants: [g("GC", { campId: "sft-a" })] }, false],
    ["an ASA", { personId: null, grants: W.ASA }, false],
    ["an admin", { personId: null, grants: W.ADMIN }, false],
    ["someone not on the roster", { personId: null, grants: [] }, false],
  ])("a diagnosis: %s → %s", (_t, v, want) => {
    expect(recordAccess({ id: "x", ...v }, rec, now).seeMedical).toBe(want);
  });
});

describe("visitAccess: recording what the doctor gave", () => {
  const anchor = (over: object = {}) => ({ ...SLR, personId: "p1", kind: "RSO" as const, state: "APPROVED" as const, ...over });
  const trooper = as([], "p1");
  const ps = as(W["PS · PLATOON 6"], "p2");

  it("the trooper's own, once his report sick is approved (or an MA recorded)", () => {
    expect(visitAccess(trooper, { anchor: anchor(), parentKind: "RSO", outcome: [] }).recordOutcome).toBe(true);
    expect(visitAccess(trooper, { anchor: anchor({ state: "PENDING" }), parentKind: "RSO", outcome: [] }).recordOutcome).toBe(false);
    expect(visitAccess(trooper, { anchor: anchor({ kind: "MA", state: "RECORDED" }), parentKind: "MA", outcome: [] }).recordOutcome).toBe(true);
  });

  it("a standalone MC only while it stands", () => {
    const mc = anchor({ kind: "MC", state: "RECORDED" });
    expect(visitAccess(trooper, { anchor: mc, parentKind: null, outcome: [{}] }).recordOutcome).toBe(true);
    expect(visitAccess(trooper, { anchor: mc, parentKind: null, outcome: [] }).recordOutcome).toBe(false);
  });

  it("his commanders read it and mark ONENS, but don't write it", () => {
    expect(visitAccess(ps, { anchor: anchor(), parentKind: "RSO", outcome: [] })).toEqual({ recordOutcome: false, seeMedical: true, markOnens: true });
    expect(visitAccess(as(W["GC · SLR"]), { anchor: anchor(), parentKind: "RSO", outcome: [] })).toEqual({ recordOutcome: false, seeMedical: false, markOnens: false });
  });
});

// ------------------------------------------------------------------ RF

describe("rfAccess and assignmentAccess", () => {
  const now = new Date("2026-09-30T03:00:00Z");
  const request = (over: Partial<RfRequestView> = {}): RfRequestView => ({
    id: "rf1",
    ...SLR,
    campName: "SLR",
    subunitName: "PLATOON 6",
    role: "ST CBT",
    need: 2,
    reason: "",
    state: "OPEN",
    raisedById: "m-raiser",
    raisedBy: "3SG TAN",
    raisedByTelegramId: null,
    closedBy: null,
    createdAt: now,
    startAt: new Date(now.getTime() + 3_600_000),
    endAt: new Date(now.getTime() + 7_200_000),
    deployed: [],
    ...over,
  });

  it("the raiser opens and closes it without an RF role, but doesn't deploy", () => {
    expect(rfAccess(as([], null, "m-raiser"), request(), now)).toMatchObject({ asks: true, open: true, deploy: false, close: true });
  });

  it("the camp's commanders close it; anyone with an RF role deploys", () => {
    expect(rfAccess(as(W["GC · SLR"]), request(), now)).toMatchObject({ asks: true, open: true, deploy: true, close: true });
    expect(rfAccess(as(W["PS · PLATOON 5"]), request(), now)).toMatchObject({ asks: false, open: true, deploy: true, close: false });
    expect(rfAccess(as(W.ADMIN), request(), now)).toMatchObject({ asks: false, open: false, deploy: false, close: false });
  });

  it("Close only while OPEN; Deploy and Stand down end with the shift", () => {
    expect(rfAccess(as(W["GC · SLR"]), request({ state: "FILLED" }), now)).toMatchObject({ asks: true, deploy: false, close: false });
    const over = request({ endAt: new Date(now.getTime() - 1) });
    expect(rfAccess(as(W["GC · SLR"]), over, now).deploy).toBe(false);
    expect(rfAccess(as(W["GC · SLR"]), over, now).standDown(BDK)).toBe(false);
  });

  it("Stand down: whoever may send him, or the camp that asked", () => {
    expect(rfAccess(as(W["PS · PLATOON 5"]), request(), now).standDown(BDK)).toBe(true);
    expect(rfAccess(as(W["GC · SLR"]), request(), now).standDown(BDK)).toBe(true);
    expect(rfAccess(as([g("GC", { campId: "sft-a" })]), request(), now).standDown(BDK)).toBe(false);
    // an assignment without a request: whoever may send him only
    expect(assignmentAccess(as(W["GC · SLR"]), { man: BDK, request: null }).standDown).toBe(false);
    expect(assignmentAccess(as(W["PS · PLATOON 5"]), { man: BDK, request: null }).standDown).toBe(true);
    // the raiser, whatever he holds now
    expect(assignmentAccess(as([], null, "m-raiser"), { man: BDK, request: request() }).standDown).toBe(true);
  });
});

// ROT (phases-plan §2): an SC mirrors a GC, at section level. PLATOON 1's
// SECTION 1 and 2 are camps; the SC holds SECTION 1.
describe("an SC mirrors a GC (ROT)", () => {
  const PL1 = "pl1";
  const S1 = { subunitId: PL1, campId: "s1" };
  const S2 = { subunitId: PL1, campId: "s2" };
  const sc = as([g("SC", { campId: "s1" })]);

  it("sees Manpower, Add for several men, Roster and Parade state; not Inbox, HOTO, RF or Shifts", () => {
    const s = screens(sc);
    expect(Object.keys(s).filter((k) => s[k as Screen]).sort()).toEqual(["add", "manpower", "parade", "roster"]);
  });

  it("reaches his own section only", () => {
    expect(reach(sc, "roster")).toEqual({ subunitIds: [], campIds: ["s1"] });
    expect(reach(sc, "parade")).toEqual({ subunitIds: [], campIds: ["s1"] });
    expect(manAccess(sc, S1)).toMatchObject({ commands: false, sends: false, proxies: true, removes: false, history: false, confirmsBack: true });
    expect(manAccess(sc, S2)).toMatchObject({ proxies: false, confirmsBack: false });
    expect(campAccess(sc, S1)).toEqual({ asks: false, forecast: true });
    expect(campAccess(sc, S2).forecast).toBe(false);
  });

  it("approves nothing and never sees a man's records", () => {
    const r = { personId: "t", ownerRoles: [], ...S1, state: "PENDING" as const, decidedBy: null, decidedAt: null, decisionNote: null };
    expect(recordAccess(sc, r)).toMatchObject({ view: false, decide: false, void: false, seeMedical: false });
  });

  it("without a section it counts for nothing", () => {
    expect(Object.values(screens(as([g("SC")]))).some(Boolean)).toBe(false);
    expect(Object.values(screens(as([g("SC", { subunitId: PL1 })]))).some(Boolean)).toBe(false);
  });
});

// ------------------------------------------------------------------ report for your men (2026-10-24)

describe("reportAccess: report sick or an MA for one of his men", () => {
  const man = (where: { subunitId: string; campId: string }, ownerRoles: GrantRow["role"][] = [], personId = "p-man") => ({ ...where, personId, ownerRoles });
  const rows: [Who, { subunitId: string; campId: string }, boolean, boolean][] = [
    // who, the man's camp, reports, saved approved
    ["GC · SLR", SLR, true, false],
    ["GC · SLR", SFT_A, false, false], // a sibling camp
    ["GC · company (campless)", SLR, false, false],
    ["PS · PLATOON 6", SLR, true, true],
    ["PS · PLATOON 6", BDK, false, false],
    ["PC · PLATOON 6", SFT_B, true, true],
    ["OC", BDK, true, true],
    ["2IC", SLR, true, true],
    ["CSM", SLR, true, true],
    ["ASA", SLR, false, false],
    ["ADMIN", SLR, false, false],
    ["nobody", SLR, false, false],
  ];
  it.each(rows)("%s → a man at %o: reports %s, approved on save %s", (who, where, reports, approved) => {
    expect(reportAccess(as(W[who], "p-viewer"), man(where))).toEqual({ reports, approvesOnSave: approved });
  });

  it("never for himself; a PS reporting another PS waits for the PC", () => {
    expect(reportAccess(as(W["PS · PLATOON 6"], "p-man"), man(SLR))).toEqual({ reports: false, approvesOnSave: false });
    // the man is a PS: only the PC (or company) approves him, so another PS's report waits
    expect(reportAccess(as(W["PS · PLATOON 6"], "p-viewer"), man(SLR, ["PS"]))).toEqual({ reports: true, approvesOnSave: false });
    expect(reportAccess(as(W["PC · PLATOON 6"], "p-viewer"), man(SLR, ["PS"]))).toEqual({ reports: true, approvesOnSave: true });
    // the man is a GC: his PC or PS approves, as for any trooper
    expect(reportAccess(as(W["PS · PLATOON 6"], "p-viewer"), man(SLR, ["GC"]))).toEqual({ reports: true, approvesOnSave: true });
  });
});
