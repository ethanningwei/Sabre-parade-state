import { describe, expect, it } from "vitest";
import { computeCoy } from "@/lib/parade/compute";
import { sgtToInstant } from "@/lib/parade/time";
import type { CoySnapshot, SnapshotDuty } from "@/lib/parade/types";
import { clashLines } from "@/lib/wb/domain/clash";
import { manningOf, snapshotFor, worstDayOf, type AssignmentRow, type ForecastInput, type TimelineRow } from "@/lib/wb/domain/forecast";
import type { GrantRow } from "@/lib/wb/domain/grants";
import {
  assignRefusal,
  canDeployRf,
  canRaiseRf,
  deployRefusal,
  headDownText,
  isOver,
  rankCandidates,
  rfAnything,
  rfButtons,
  rfCardText,
  RF_CALLBACK,
  rfCloseData,
  sentNotice,
  shortBy,
  standDownNotice,
  stateAfter,
  wants,
  type Candidate,
  type LiveAssignment,
  type Man,
  type RfRequestView,
} from "@/lib/wb/domain/rf";
import { parseMinimum } from "@/lib/wb/domain/shifts";
import { dateRange, dayRange, stampRange } from "@/lib/wb/domain/timeline";
import { exampleSnapshot } from "../fixtures/example-snapshot";

// RF requests and assignments, pure: the card, the buttons, who may do what,
// the refusals, and Extra/RF/SOL in the forecast (v1's rule, through the
// unchanged computeCoy).

const NOW = sgtToInstant({ date: "2026-09-30", time: "1100" });

// ------------------------------------------------------------------ the request

const request = (over: Partial<RfRequestView> = {}): RfRequestView => ({
  id: "11111111-1111-4111-8111-111111111111",
  campId: "camp:SLR",
  campName: "SLR",
  subunitId: "pl6",
  subunitName: "PLATOON 6",
  role: "ST CBT",
  need: 2,
  reason: "TWO ON MC",
  state: "OPEN",
  raisedById: "m1",
  raisedBy: "3SG TAN",
  raisedByTelegramId: 42,
  closedBy: null,
  createdAt: NOW,
  ...stampRange("2026-10-01", "2100", "2026-10-02", "0900"),
  deployed: [],
  ...over,
});
const sent = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ assignmentId: `a${i}`, personId: `p${i}`, rank: "PTE", name: `MAN ${i + 1}`, campName: "BDK" }));

describe("an RF request", () => {
  it("is short by what's still needed, never below zero", () => {
    expect(shortBy(request())).toBe(2);
    expect(shortBy(request({ deployed: sent(1) }))).toBe(1);
    expect(shortBy(request({ deployed: sent(3) }))).toBe(0);
  });

  it("reads 1x GC or 2x any role", () => {
    expect(wants({ need: 1, role: "GC" })).toBe("1x GC");
    expect(wants({ need: 2, role: "ANY" })).toBe("2x any role");
  });

  it("fills on the last man, reopens when one is stood down, and stays closed", () => {
    expect(stateAfter("OPEN", 2, 1)).toBe("OPEN");
    expect(stateAfter("OPEN", 2, 2)).toBe("FILLED");
    expect(stateAfter("FILLED", 2, 1)).toBe("OPEN");
    expect(stateAfter("CLOSED", 2, 0)).toBe("CLOSED");
    expect(stateAfter("CLOSED", 2, 2)).toBe("CLOSED");
  });

  it("is over once its end has passed", () => {
    expect(isOver(request(), NOW)).toBe(false);
    expect(isOver(request(), sgtToInstant({ date: "2026-10-02", time: "0900" }))).toBe(true);
  });

  it("card: the handwritten shape, what's outstanding, and who asked", () => {
    const text = rfCardText(request({ deployed: sent(1) }), NOW);
    expect(text).toBe(
      [
        "🚌 RF REQUEST",
        "",
        "Camp: SLR · PLATOON 6",
        "Duration: 01/10 2100–02/10 0900",
        "Manpower required: 2x ST CBT",
        "Reason: TWO ON MC",
        "Manpower deployed: PTE MAN 1 (BDK)",
        "",
        "⏳ Still short 1 of 2",
        "raised by 3SG TAN",
      ].join("\n"),
    );
    expect(rfCardText(request({ state: "FILLED", deployed: sent(2) }), NOW)).toContain("✅ FILLED");
    expect(rfCardText(request({ state: "CLOSED", closedBy: "2SG LIM" }), NOW)).toContain("❌ CLOSED — no longer needed (2SG LIM)");
    expect(rfCardText(request(), sgtToInstant({ date: "2026-10-03", time: "0000" }))).toContain("⌛ Over, still short 2 of 2");
    expect(rfCardText(request(), NOW)).not.toContain("Manpower deployed");
  });

  it("buttons: Deploy and Close for everyone, Close only on the raiser's copy, Open only once settled", () => {
    const r = request();
    expect(rfButtons(r, false)).toEqual([
      [
        { text: "📌 Deploy someone", route: `rf/${r.id}/deploy` },
        { text: "❌ Close", data: `f:${r.id}:x` },
      ],
      [{ text: "Open", route: `rf/${r.id}` }],
    ]);
    expect(rfButtons(r, true)).toEqual([[{ text: "❌ Close", data: `f:${r.id}:x` }], [{ text: "Open", route: `rf/${r.id}` }]]);
    for (const state of ["FILLED", "CLOSED"] as const) expect(rfButtons({ ...r, state }, false)).toEqual([[{ text: "Open", route: `rf/${r.id}` }]]);
    expect(RF_CALLBACK.exec(rfCloseData(r.id))?.[1]).toBe(r.id);
    expect(Buffer.byteLength(rfCloseData(r.id))).toBeLessThanOrEqual(64);
  });
});

// ------------------------------------------------------------------ who

const grant = (role: GrantRow["role"], subunitId: string | null = null, campId: string | null = null): GrantRow => ({ role, subunitId, campId });
const slr = { subunitId: "pl6", campId: "camp:SLR" };
const srf = { subunitId: "pl6", campId: "camp:SRF A" };
const bdk = { subunitId: "pl7", campId: "camp:BDK" };

describe("who may raise, deploy and assign", () => {
  it("a GC for his own camp and its men only", () => {
    const gc = [grant("GC", null, "camp:SLR")];
    expect(canRaiseRf(gc, slr)).toBe(true);
    expect(canRaiseRf(gc, srf)).toBe(false);
    expect(canDeployRf(gc, slr)).toBe(true);
    expect(canDeployRf(gc, bdk)).toBe(false);
  });

  it("a PC or PS for their platoon", () => {
    for (const role of ["PC", "PS"] as const) {
      const g = [grant(role, "pl6")];
      expect(canRaiseRf(g, srf)).toBe(true);
      expect(canDeployRf(g, slr)).toBe(true);
      expect(canDeployRf(g, bdk)).toBe(false);
    }
  });

  it("OC, 2IC, CSM and ASA company-wide", () => {
    for (const role of ["OC", "2IC", "CSM", "ASA"] as const) {
      const g = [grant(role)];
      expect(canRaiseRf(g, bdk)).toBe(true);
      expect(canDeployRf(g, slr)).toBe(true);
      expect(rfAnything(g)).toBe(true);
    }
  });

  it("not ADMIN alone, and not a trooper", () => {
    expect(rfAnything([grant("ADMIN")])).toBe(false);
    expect(canRaiseRf([grant("ADMIN")], slr)).toBe(false);
    expect(rfAnything([])).toBe(false);
  });
});

// ------------------------------------------------------------------ refusals

const man = (over: Partial<Man> = {}): Man => ({ personId: "p9", rank: "PTE", name: "LIM", subunitId: "pl7", campId: "camp:BDK", campName: "BDK", ...over });
const live = (over: Partial<LiveAssignment> = {}): LiveAssignment => ({
  id: "x1",
  personId: "p9",
  type: "RF",
  campId: "camp:HDN",
  campName: "HDN",
  ...dateRange("2026-10-02", "2026-10-02"),
  ...over,
});

describe("deploy refusals", () => {
  it("lets a man from another camp go", () => {
    expect(deployRefusal(request(), man(), [], NOW)).toBeNull();
  });

  it("refuses a closed, filled or finished request", () => {
    expect(deployRefusal(request({ state: "CLOSED" }), man(), [], NOW)).toMatch(/closed/);
    expect(deployRefusal(request({ state: "FILLED", deployed: sent(2) }), man(), [], NOW)).toMatch(/Somebody got there first/);
    expect(deployRefusal(request({ deployed: sent(2) }), man(), [], NOW)).toMatch(/Somebody got there first/);
    expect(deployRefusal(request(), man(), [], sgtToInstant({ date: "2026-10-02", time: "1000" }))).toMatch(/over/);
  });

  it("refuses the camp's own man, and a man already sent somewhere then", () => {
    expect(deployRefusal(request(), man({ campId: "camp:SLR", campName: "SLR" }), [], NOW)).toBe("PTE LIM is SLR's own. RF is served at another camp.");
    expect(deployRefusal(request(), man(), [live()], NOW)).toBe("PTE LIM is already on RF @ HDN 02/10.");
    // touching ends don't clash: his RF ends at 2100 on 01/10, this one starts then
    expect(deployRefusal(request(), man(), [live({ ...stampRange("2026-10-01", "0900", "2026-10-01", "2100") })], NOW)).toBeNull();
    // someone else's assignment is no business of his
    expect(deployRefusal(request(), man(), [live({ personId: "p8" })], NOW)).toBeNull();
  });

  it("Assign: Extra/RF need another camp; SOL needs none; never twice at once", () => {
    const range = dateRange("2026-10-05", "2026-10-06");
    expect(assignRefusal("EXTRA", null, man(), range, [])).toBe("Pick the camp they're serving at.");
    expect(assignRefusal("EXTRA", "camp:BDK", man(), range, [])).toBe("Extra can't be served at his own team (BDK). Pick another camp.");
    expect(assignRefusal("RF", "camp:SLR", man(), range, [])).toBeNull();
    expect(assignRefusal("SOL", null, man(), range, [])).toBeNull();
    expect(assignRefusal("SOL", null, man(), range, [live({ type: "SOL", ...dateRange("2026-10-06", "2026-10-10") })])).toMatch(/already on SOL/);
  });
});

// ------------------------------------------------------------------ messages

describe("what the man and his commanders are told", () => {
  const range = stampRange("2026-10-01", "2100", "2026-10-02", "0900");

  it("the man: where, when, absent from where, and what he's already down for", () => {
    const text = sentNotice({ type: "RF", range, at: "SLR", home: "BDK", by: "2SG KOH", viaRequest: true, away: ["AL 01/10–03/10"] });
    expect(text).toBe(
      "🚌 You've been sent on RF\n\nRF @ SLR 01/10 2100–02/10 0900\nAbsent from BDK, counted at SLR.\n\nSent by 2SG KOH. Report to SLR.\n\n⚠️ I have you down as away then\n• AL 01/10–03/10\n\nIf that's still right, tell whoever sent you.",
    );
    expect(sentNotice({ type: "EXTRA", range, at: "SLR", home: "BDK", by: "X", viaRequest: false, away: [] })).toMatch(/^📌 You've been put on Extra/);
    expect(sentNotice({ type: "SOL", range, at: "BDK", home: "BDK", by: "X", viaRequest: false, away: [] })).toMatch(/^⛔ You're on SOL\n\nSOL 01\/10 2100–02\/10 0900\nYour leave is stopped/);
    expect(standDownNotice({ type: "RF", range, at: "SLR", by: "2SG KOH" })).toBe("↩️ Stood down\n\nRF @ SLR 01/10 2100–02/10 0900\n\n2SG KOH cancelled it. You're back with your own camp.");
  });

  it("his platoon: a head down, and what it does to his camp", () => {
    const text = headDownText({ type: "RF", man: man(), range, at: "SLR", by: "2SG KOH", viaRequest: true, away: [], manning: "BDK on 01/10: 1:3:3 / min 1:4:3 — BELOW MINIMUM" });
    expect(text).toBe("🚌 Sent on RF by 2SG KOH\n\nPTE LIM (BDK)\nRF @ SLR 01/10 2100–02/10 0900\nAbsent from BDK, counted at SLR.\n\n⚠️ BDK on 01/10: 1:3:3 / min 1:4:3 — BELOW MINIMUM");
    expect(headDownText({ type: "EXTRA", man: man(), range, at: "SLR", by: "X", viaRequest: false, away: ["MC 01/10"], manning: null })).toMatch(/^📌 Extra by X[\s\S]*⚠️ He's already down as away\n• MC 01\/10$/);
  });

  it("the clash check lists live Extra/RF/SOL", () => {
    const lines = clashLines(dateRange("2026-10-02", "2026-10-03"), [], [], [{ type: "SOL", campName: "SFT A", ...dateRange("2026-10-01", "2026-10-05") }, { type: "RF", campName: "HDN", ...dateRange("2026-10-10", "2026-10-10") }]);
    expect(lines).toEqual(["SOL @ SFT A 01/10–05/10"]);
  });
});

describe("the deploy list", () => {
  const c = (name: string, over: Partial<Candidate> = {}): Candidate => ({ ...man({ name, personId: name }), role: "ST CBT", away: [], refusal: null, manning: null, short: false, free: false, ...over });

  it("best first: can go, fits, his camp is off, nothing in the way, his camp stays above minimum", () => {
    const list = rankCandidates("ST CBT", [
      c("REFUSED", { refusal: "x" }),
      c("WRONG ROLE", { role: "ST SVC" }),
      c("SHORT", { short: true }),
      c("AWAY", { away: ["AL"] }),
      c("PLAIN"),
      c("FREE", { free: true }),
    ]);
    expect(list.map((x) => x.name)).toEqual(["FREE", "PLAIN", "SHORT", "AWAY", "WRONG ROLE", "REFUSED"]);
    expect(rankCandidates("ANY", [c("B", { role: "ST SVC" }), c("A")]).map((x) => x.name)).toEqual(["A", "B"]);
  });
});

// ------------------------------------------------------------------ the forecast

const base = (): CoySnapshot => {
  // the roster only: the forecast never reads v1's own absences or duties
  const s = exampleSnapshot();
  return { ...s, subunits: s.subunits.map((u) => ({ ...u, camps: u.camps.map((c) => ({ ...c, people: c.people.map((p) => ({ ...p, absence: null })) })) })), duties: [] };
};
const campOf = (s: CoySnapshot, name: string) => s.subunits.flatMap((u) => u.camps).find((c) => c.name === name)!;
let seq = 0;
const assignment = (personId: string, type: AssignmentRow["type"], campId: string, start: string, end: string): AssignmentRow => ({
  id: `00000000-0000-4000-9000-${String(++seq).padStart(12, "0")}`,
  personId,
  type,
  campId,
  ...dateRange(start, end),
});
// no patterns: every camp keeps the fixture's v1 shift (SFT A, OSU A, PYAD A off)
const input = (s: CoySnapshot, assignments: AssignmentRow[] = [], records: TimelineRow[] = []): ForecastInput => ({ base: s, now: NOW, patterns: new Map(), records, assignments });
const byName = (s: CoySnapshot, m: ReturnType<typeof manningOf>, name: string) => m.find((x) => x.campId === campOf(s, name).id)!;
const TODAY = dayRange("2026-09-30");

describe("assignments in the forecast", () => {
  it("an RF man counts where he's sent and is away at home", () => {
    const s = base();
    const him = campOf(s, "BDK").people[0];
    const before = manningOf(snapshotFor(input(s), TODAY));
    const a = assignment(him.id, "RF", campOf(s, "SLR").id, "2026-09-30", "2026-09-30");
    const after = manningOf(snapshotFor(input(s, [a]), TODAY));
    expect(byName(s, after, "SLR").strength.present).toBe(byName(s, before, "SLR").strength.present + 1);
    expect(byName(s, after, "SLR").duties.map((d) => d.personId)).toEqual([him.id]);
    expect(byName(s, after, "BDK").strength.present).toBe(byName(s, before, "BDK").strength.present - 1);
    expect(byName(s, after, "BDK").away).toEqual([
      expect.objectContaining({ personId: him.id, what: "OTHERS: RF @ SLR", dates: "30/09", recordId: null, assignmentId: a.id, pending: false }),
    ]);
  });

  it("matches v1 exactly when the same RF is a v1 duty with its home absence", () => {
    const s = base();
    const him = campOf(s, "BDK").people[0];
    const slr = campOf(s, "SLR").id;
    const fromWb = snapshotFor(input(s, [assignment(him.id, "RF", slr, "2026-09-30", "2026-09-30")]), TODAY).snapshot;
    const duty: SnapshotDuty = { id: "d1", type: "RF", rank: him.rank, name: him.name, personId: him.id, campId: slr, startDate: "2026-09-30", startTime: null, endDate: "2026-09-30", endTime: null };
    const v1: CoySnapshot = {
      ...s,
      subunits: s.subunits.map((u) => ({
        ...u,
        camps: u.camps.map((c) => ({
          ...c,
          people: c.people.map((p) =>
            p.id === him.id
              ? { ...p, absence: { id: "a1", type: "OTHERS" as const, otherReason: "RF @ SLR", startDate: "2026-09-30", startTime: "0000", endDate: "2026-10-01", endTime: "0000", maTiming: "", maLocation: "" } }
              : p,
          ),
        })),
      })),
      duties: [duty],
    };
    const shape = (x: CoySnapshot) =>
      computeCoy(x).subunits.map((u) => ({
        present: u.present,
        total: u.total,
        camps: u.camps.map((c) => ({ name: c.camp.name, present: c.present, away: c.absentees.map((p) => `${p.id} ${p.absence!.type} ${p.absence!.otherReason}`), rf: c.duties.RF.map((d) => d.personId) })),
      }));
    expect(shape(fromWb)).toEqual(shape(v1));
  });

  it("a real absence at home is kept, and he still counts where he's sent", () => {
    const s = base();
    const him = campOf(s, "BDK").people[0];
    const mc: TimelineRow = { id: "00000000-0000-4000-8000-000000000001", personId: him.id, kind: "MC", state: "RECORDED", ...dateRange("2026-09-30", "2026-10-01"), detail: "" };
    const m = manningOf(snapshotFor(input(s, [assignment(him.id, "RF", campOf(s, "SLR").id, "2026-09-30", "2026-09-30")], [mc]), TODAY));
    expect(byName(s, m, "BDK").away).toEqual([expect.objectContaining({ personId: him.id, what: "MC", recordId: mc.id, assignmentId: null })]);
    expect(byName(s, m, "SLR").duties.map((d) => d.personId)).toEqual([him.id]);
  });

  it("an RF at a camp that's off shift isn't counted there, but he's still away at home (v1)", () => {
    const s = base();
    const him = campOf(s, "BDK").people[0];
    const m = manningOf(snapshotFor(input(s, [assignment(him.id, "RF", campOf(s, "SFT A").id, "2026-09-30", "2026-09-30")]), TODAY));
    expect(byName(s, m, "SFT A").duties).toEqual([]);
    expect(byName(s, m, "BDK").away.map((a) => a.what)).toEqual(["OTHERS: RF @ SFT A"]);
  });

  it("Extra works the same way", () => {
    const s = base();
    const him = campOf(s, "HDN").people[0];
    const m = manningOf(snapshotFor(input(s, [assignment(him.id, "EXTRA", campOf(s, "TFT").id, "2026-09-30", "2026-09-30")]), TODAY));
    expect(byName(s, m, "TFT").duties.map((d) => [d.type, d.personId])).toEqual([["EXTRA", him.id]]);
    expect(byName(s, m, "HDN").away.map((a) => a.what)).toEqual(["OTHERS: EXTRA @ TFT"]);
  });

  it("SOL: counted under the on-shift team when his own is off, simply present when it's on, never away", () => {
    const s = base();
    const offMan = campOf(s, "SFT A").people[0]; // SFT A is off in the fixture
    const onMan = campOf(s, "SFT B").people[0];
    const m = manningOf(
      snapshotFor(input(s, [assignment(offMan.id, "SOL", campOf(s, "SFT A").id, "2026-09-25", "2026-10-08"), assignment(onMan.id, "SOL", campOf(s, "SFT B").id, "2026-09-25", "2026-10-08")]), TODAY),
    );
    expect(byName(s, m, "SFT B").duties.map((d) => [d.type, d.personId])).toEqual([["SOL", offMan.id]]);
    expect(byName(s, m, "SFT A").duties).toEqual([]);
    expect(m.flatMap((c) => c.away)).toEqual([]);
  });

  it("only assignments that touch the window count", () => {
    const s = base();
    const him = campOf(s, "BDK").people[0];
    const m = manningOf(snapshotFor(input(s, [assignment(him.id, "RF", campOf(s, "SLR").id, "2026-10-01", "2026-10-02")]), TODAY));
    expect(m.flatMap((c) => c.away)).toEqual([]);
    expect(m.flatMap((c) => c.duties)).toEqual([]);
  });

  it("a camp's worst day over a range counts the men sent away from it", () => {
    const s = base();
    const bdk = campOf(s, "BDK");
    for (const [i, p] of bdk.people.entries()) p.role = i === 0 ? "GC" : i <= 4 ? "ST CBT" : "ST SVC";
    const min = parseMinimum("1:4:3")!;
    const a = assignment(bdk.people[1].id, "RF", campOf(s, "SLR").id, "2026-09-30", "2026-09-30");
    const w = worstDayOf(input(s, [a]), bdk.id, dateRange("2026-09-29", "2026-09-30"), min)!;
    expect(w.date).toBe("2026-09-30");
    expect(w.verdict.gaps).toEqual([{ role: "ST CBT", short: 1 }]);
  });
});
