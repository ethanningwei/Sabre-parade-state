import { describe, expect, it } from "vitest";
import { matchPasted, parsePastedList, type PoolPerson } from "@/lib/wb/domain/paste";

// The changeover's paste reader: the mockup's message, and the ways a real
// Telegram list goes wrong.

const MESSAGE = `ROT PLATOONS & SECTIONS

PLATOON 1
Section 1
1. 3SG Alpha Tan (SC)
2. PTE Oscar Lee
3. LCP Papa Chua
4. Quebec Teo

Section 2
1. CPL Delta Ng
2. PTE Romeo Goh
3. Isaac

Section 3
1. CPL Sierra Pang
2. PTE New Guy

PLATOON 2
Section 1
1. 3SG Lima Yeo
...`;

describe("parsePastedList", () => {
  it("reads the mockup's message: headers set where everyone below goes", () => {
    const l = parsePastedList(MESSAGE);
    expect(l.structure).toEqual([
      { platoon: "PLATOON 1", sections: ["SECTION 1", "SECTION 2", "SECTION 3"] },
      { platoon: "PLATOON 2", sections: ["SECTION 1"] },
    ]);
    expect(l.names.map((n) => [n.rank, n.name, n.platoon, n.section, n.sc])).toEqual([
      ["3SG", "ALPHA TAN", "PLATOON 1", "SECTION 1", true],
      ["PTE", "OSCAR LEE", "PLATOON 1", "SECTION 1", false],
      ["LCP", "PAPA CHUA", "PLATOON 1", "SECTION 1", false],
      [null, "QUEBEC TEO", "PLATOON 1", "SECTION 1", false],
      ["CPL", "DELTA NG", "PLATOON 1", "SECTION 2", false],
      ["PTE", "ROMEO GOH", "PLATOON 1", "SECTION 2", false],
      [null, "ISAAC", "PLATOON 1", "SECTION 2", false],
      ["CPL", "SIERRA PANG", "PLATOON 1", "SECTION 3", false],
      ["PTE", "NEW GUY", "PLATOON 1", "SECTION 3", false],
      ["3SG", "LIMA YEO", "PLATOON 2", "SECTION 1", false],
    ]);
    expect(l.names[0].line).toBe(5);
  });

  it("takes bold, emoji, bullets, short headers and a header with a note", () => {
    const l = parsePastedList("*PLT 3*\n*SEC 1 (SC: 3SG TAN)*\n• pte john doe\n- LCP Ali bin Abu - SC\n1) Kumar s/o Raju\n1️⃣ Ben\nPLATOON 4 SECTION 2:\nJoe");
    expect(l.structure).toEqual([
      { platoon: "PLATOON 3", sections: ["SECTION 1"] },
      { platoon: "PLATOON 4", sections: ["SECTION 2"] },
    ]);
    expect(l.names.map((n) => [n.name, n.section, n.sc])).toEqual([
      ["JOHN DOE", "SECTION 1", false],
      ["ALI BIN ABU", "SECTION 1", true],
      ["KUMAR S/O RAJU", "SECTION 1", false],
      ["BEN", "SECTION 1", false],
      ["JOE", "SECTION 2", false],
    ]);
  });

  it("ignores lines that aren't names and names with no section above them", () => {
    const l = parsePastedList("Pls check your names by 2359!!\nPLATOON 1\nJohn Tan\nSection 1\n12 pax\nPLUTO TAN\nSECRET LIM");
    expect(l.names.map((n) => n.name)).toEqual(["PLUTO TAN", "SECRET LIM"]);
    expect(l.homeless).toEqual(["John Tan"]);
  });
});

const pool: PoolPerson[] = [
  { personId: "a", name: "ALPHA TAN", rank: "3SG", campName: "SLR", skip: null, linkedMemberId: null },
  { personId: "i1", name: "ISAAC TAN", rank: "PTE", campName: "SFT B", skip: null, linkedMemberId: null },
  { personId: "i2", name: "ISAAC PEH", rank: "PTE", campName: "PRC", skip: null, linkedMemberId: null },
  { personId: "l1", name: "LEE", rank: "CPL", campName: "SLR", skip: null, linkedMemberId: null },
  { personId: "l2", name: "LEE KUAN", rank: "PTE", campName: "BDK", skip: null, linkedMemberId: null },
  { personId: "s", name: "SVC MAN", rank: "PTE", campName: "SLR", skip: "svc", linkedMemberId: null },
  { personId: "j1", name: "JOSEPH", rank: "LCP", campName: "SFT A", skip: null, linkedMemberId: null },
  { personId: "j2", name: "JOSEPH KOH", rank: "LCP", campName: "SLR", skip: "svc", linkedMemberId: null },
];

describe("matchPasted", () => {
  const rows = (text: string) => matchPasted(parsePastedList(`PLATOON 1\nSECTION 1\n${text}`), pool).map((r) => r.verdict);

  it("matched, not sure, not on the roster", () => {
    expect(rows("3SG Alpha Tan\nIsaac\nNew Guy")).toEqual([
      { kind: "matched", person: pool[0] },
      { kind: "unsure", people: [pool[1], pool[2]] },
      { kind: "missing" },
    ]);
  });

  it("a rank that agrees narrows two candidates to one; one that agrees with nobody asks", () => {
    expect(rows("PTE Isaac Tan")).toEqual([{ kind: "matched", person: pool[1] }]);
    expect(rows("Lee")).toEqual([{ kind: "matched", person: pool[3] }]); // exact name first
    expect(rows("PTE Lee")).toEqual([{ kind: "unsure", people: [pool[3], pool[4]] }]);
  });

  it("a combat trooper beats an SVC namesake", () => {
    expect(rows("LCP Josep")).toEqual([{ kind: "matched", person: pool[6] }]);
  });

  it("an SVC trooper is skipped, and a man named twice keeps his first place", () => {
    expect(rows("SVC Man\nAlpha Tan\nALPHA TAN")).toEqual([
      { kind: "skip", person: pool[5], why: "svc" },
      { kind: "matched", person: pool[0] },
      { kind: "skip", person: pool[0], why: "twice" },
    ]);
  });
});
