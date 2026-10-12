import { describe, expect, it } from "vitest";
import { ddmmyy, leaveDays, linkedToSomeoneElse, matchName, nric4, PICK_MAX } from "@/lib/wb/domain/registration";
import { roleOf, rolesFor } from "@/lib/wb/domain/roles";

const person = (name: string, linkedMemberId: string | null = null) => ({ personId: `p:${name}`, name, linkedMemberId });
const pool = [
  person("CHUN HEI"),
  person("CHUN WEI"),
  person("TAN"),
  person("TAN AH KOW"),
  person("ETHAN TEO", "m1"),
  ...Array.from({ length: PICK_MAX + 1 }, (_, i) => person(`SFTA PRESENT ${i + 1}`)),
];

describe("name matching", () => {
  it("prefers an exact match, case-insensitively", () => {
    expect(matchName("tan", pool)).toEqual({ kind: "one", person: pool[2] });
    expect(matchName("  Tan   Ah  kow ", pool)).toEqual({ kind: "one", person: pool[3] });
  });

  it("falls back to partial matches", () => {
    expect(matchName("kow", pool)).toEqual({ kind: "one", person: pool[3] });
  });

  it("offers a pick for 2 to PICK_MAX matches", () => {
    expect(matchName("chun", pool)).toEqual({ kind: "pick", people: [pool[0], pool[1]] });
  });

  it("asks for more past PICK_MAX", () => {
    expect(matchName("present", pool)).toEqual({ kind: "too-many", count: PICK_MAX + 1 });
  });

  it("finds nobody for no match or an empty query", () => {
    expect(matchName("zzz", pool)).toEqual({ kind: "none" });
    expect(matchName("   ", pool)).toEqual({ kind: "none" });
  });

  it("still matches people already linked, so they can be told why", () => {
    const m = matchName("ethan teo", pool);
    expect(m.kind === "one" && m.person.linkedMemberId).toBe("m1");
    expect(linkedToSomeoneElse(pool[4], "m2")).toBe(true);
    expect(linkedToSomeoneElse(pool[4], "m1")).toBe(false);
    expect(linkedToSomeoneElse(pool[0], "m2")).toBe(false);
  });
});

describe("NRIC last 4", () => {
  it.each([
    ["567A", "567A"],
    ["567a", "567A"],
    ["S1234567D", "567D"],
    ["s 1234-567 d", "567D"],
    ["T0123456Z", "456Z"],
  ])("%s -> %s", (raw, want) => expect(nric4(raw)).toBe(want));

  it.each(["", "1234", "ABCD", "56A", "S1234567"])("rejects %s", (raw) => expect(nric4(raw)).toBeNull());
});

describe("dates and numbers", () => {
  it("parses DDMMYY with separators", () => {
    expect(ddmmyy("270828")).toBe("2028-08-27");
    expect(ddmmyy("27/08/28")).toBe("2028-08-27");
    expect(ddmmyy("27-08-28")).toBe("2028-08-27");
    expect(ddmmyy("310228")).toBeNull();
    expect(ddmmyy("2708")).toBeNull();
  });

  it("parses leave days", () => {
    expect(leaveDays("14")).toBe(14);
    expect(leaveDays(" 7 days")).toBe(7);
    expect(leaveDays("0")).toBe(0);
    expect(leaveDays("")).toBeNull();
    expect(leaveDays("1000")).toBeNull();
  });
});

describe("roles", () => {
  it("normalises the roster's free-text roles", () => {
    expect(roleOf("guard  comm")).toBe("GC");
    expect(roleOf("CSM")).toBe("SM");
    expect(roleOf("st cbt")).toBe("ST CBT");
    expect(roleOf("")).toBe("");
    expect(roleOf("something else")).toBe("SOMETHING ELSE");
  });

  it("keeps HQ and guardroom roles apart", () => {
    expect(rolesFor(true)).toContain("PS");
    expect(rolesFor(false)).toEqual(["GC", "ST CBT", "ST SVC"]);
  });
});
