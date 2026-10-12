import { describe, expect, it } from "vitest";
import { matchSubunit } from "@/lib/wb/telegram/commands";

const subs = [
  { name: "COY HQ", isHq: true },
  { name: "PLATOON 5", isHq: false },
  { name: "PLATOON 6", isHq: false },
  { name: "PLATOON 16", isHq: false },
];

describe("/here argument", () => {
  it.each([
    ["PLATOON 6", "PLATOON 6"],
    ["platoon 6", "PLATOON 6"],
    ["Platoon6", "PLATOON 6"],
    ["6", "PLATOON 6"],
    ["PL6", "PLATOON 6"],
    ["pl 6", "PLATOON 6"],
    ["PLT 16", "PLATOON 16"],
    ["HQ", "COY HQ"],
    ["coy hq", "COY HQ"],
  ])("%s -> %s", (arg, want) => expect(matchSubunit(arg, subs)?.name).toBe(want));

  it.each(["", "7", "PLATOON", "ALPHA"])("%s -> nothing", (arg) => expect(matchSubunit(arg, subs)).toBeNull());
});
