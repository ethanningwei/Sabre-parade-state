import { describe, expect, it } from "vitest";
import type { CoySnapshot, Issue, SnapshotCamp } from "@/lib/parade/types";
import type { GrantRow } from "@/lib/wb/domain/grants";
import { issuesInScope, paradeStatePath, v1BackLeaves } from "@/lib/wb/domain/parade-links";
import { PARADE_STATE_ROLES } from "@/lib/wb/permissions";

const ID = "0b7e6a52-5d0e-4c3f-9b1a-2f4e8c9d1a00";

describe("paradeStatePath", () => {
  it("lets the Mini App open v1's screens", () => {
    for (const to of ["/", "/parade", "/duties", "/history", `/c/${ID}`, `/s/${ID}`]) expect(paradeStatePath(to)).toBe(to);
  });

  it("anything else lands on the Overview", () => {
    for (const to of [undefined, 1, "", "parade", "https://evil.example", "//evil.example", "/tg", "/tg/manpower", "/admin", "/c/x", `/c/${ID}/x`, `/c/${ID}?a=1`, "/parade/../tg"]) {
      expect(paradeStatePath(to)).toBe("/");
    }
  });
});

describe("v1BackLeaves", () => {
  it("leaves for the Mini App from a bottom-nav screen", () => {
    for (const p of ["/", "/duties", "/parade", "/history", "/admin", `/s/${ID}`]) expect(v1BackLeaves(p)).toBe(true);
  });

  it("goes back one screen from anything deeper", () => {
    for (const p of [`/c/${ID}`, `/history/${ID}`, "/admin/people", "/admin/settings", "/admin/structure"]) expect(v1BackLeaves(p)).toBe(false);
  });
});

describe("issuesInScope", () => {
  const camp = (id: string, onShift = true): SnapshotCamp => ({ id, name: id.toUpperCase(), post: id, onShift, people: [] });
  const snapshot: CoySnapshot = {
    coy: { id: "coy", key: "SABRE", displayName: "Sabre" },
    subunits: [
      { id: "hq", name: "COY HQ", isHq: true, camps: [camp("hqc")] },
      { id: "pl6", name: "PLATOON 6", isHq: false, camps: [camp("slr"), camp("srfa", false)] },
      { id: "pl7", name: "PLATOON 7", isHq: false, camps: [camp("bdk")] },
    ],
    duties: [
      // an RF from PL7 counted at SLR is SLR's issue
      { id: "d1", type: "RF", rank: "PTE", name: "A", personId: null, campId: "slr", startDate: null, startTime: null, endDate: null, endTime: null },
      // an SOL whose home team is on shift isn't counted anywhere: company command's
      { id: "d2", type: "SOL", rank: "PTE", name: "B", personId: "p-bdk", campId: "bdk", startDate: null, startTime: null, endDate: null, endTime: null },
    ],
  };
  snapshot.subunits[2].camps[0].people.push({ id: "p-bdk", rank: "PTE", name: "B", role: "", absence: null });

  const issue = (target: Issue["target"]): Issue => ({ code: "missing-rank", scope: [], message: "", target });
  const issues: Issue[] = [
    issue({ kind: "person", campId: "slr", personId: "x" }),
    issue({ kind: "camp", campId: "bdk" }),
    issue({ kind: "subunit", subunitId: "hq" }),
    issue({ kind: "duty", dutyId: "d1" }),
    issue({ kind: "duty", dutyId: "d2" }),
  ];
  const count = (grants: GrantRow[]) => issuesInScope(snapshot, issues, grants, PARADE_STATE_ROLES);

  it("a GC counts his own camp's, an Extra/RF/SOL counted there included", () => {
    expect(count([{ role: "GC", subunitId: null, campId: "slr" }])).toBe(2);
    expect(count([{ role: "GC", subunitId: null, campId: "srfa" }])).toBe(0);
  });

  it("a PS counts his platoon's; company command counts everything", () => {
    expect(count([{ role: "PS", subunitId: "pl7", campId: null }])).toBe(1);
    expect(count([{ role: "OC", subunitId: null, campId: null }])).toBe(5);
  });

  it("troopers' and ASAs' grants count nothing", () => {
    expect(count([{ role: "ASA", subunitId: null, campId: null }])).toBe(0);
    expect(count([])).toBe(0);
  });
});
