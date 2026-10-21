// The medical routes through the database, over a fake Telegram: the photo
// upload (stored in his own DM, handed back as a token only he can use) and
// who may read a diagnosis or fetch the photo (audited). These are HTTP routes
// on the Mini App's session, so the session cookie and grammY are faked; the
// outcome itself is saved through its Write (records.db.test.ts). Uses
// sabre_test; skipped if unreachable.

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { writeCoy } from "@/lib/data/write-coy";
import { db } from "@/lib/db";
import { camp, person, subunit } from "@/lib/db/schema";
import { wbAudit, wbCard, wbGrant, wbMember, wbRecord } from "@/lib/wb/db/schema";
import { exampleSnapshot } from "../fixtures/example-snapshot";
import { recordingCourier } from "./recording-courier";
import { acting, day, member, ok } from "./writes";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

// A fake Telegram behind the outbound module: every call is captured.
const tg = vi.hoisted(() => ({ calls: [] as { method: string; payload: Record<string, unknown> }[], next: 100 }));
vi.mock("@/lib/wb/telegram/outbound", async () => {
  const { Api } = await import("grammy");
  const api = new Api("123:TEST");
  api.config.use(async (_prev, method, payload) => {
    tg.calls.push({ method, payload: payload as Record<string, unknown> });
    if (method === "getFile") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { ok: true, result: { file_id: (payload as any).file_id, file_unique_id: "u", file_path: "photos/file_1.jpg" } } as any;
    }
    const id = ++tg.next;
    const photo = method === "sendPhoto" ? { photo: [{ file_id: `small-${id}`, file_unique_id: "s", width: 90, height: 90 }, { file_id: `PHOTO-${id}`, file_unique_id: "l", width: 1280, height: 960 }] } : {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ok: true, result: { message_id: id, date: 0, chat: { id: 0, type: "private" }, ...photo } } as any;
  });
  return { outbound: async () => ({ api, botUsername: "sabrecoybot" }) };
});

const { signIn } = await import("@/lib/wb/auth");
const medical = await import("@/lib/wb/actions/medical");
const { POST: photoRoute } = await import("@/app/api/wb/photo/route");
const { GET: fileRoute } = await import("@/app/api/wb/file/[recordId]/route");
const { readDiagnoses } = await import("@/lib/wb/medical");
const { recordView } = await import("@/lib/wb/records");
const { decide, submit } = await import("@/lib/wb/decide");
const { sickFrom } = await import("@/lib/wb/input");

let reachable = true;
let pl6: string;
let irfan: string;
let chunHei: string;

beforeAll(async () => {
  try {
    await db.execute("select 1");
  } catch {
    reachable = false;
    return;
  }
  vi.stubEnv("FEATURE_WHEREABOUTS", "1");
  vi.stubEnv("AUTH_SECRET", "a-test-secret-of-enough-length");
  await writeCoy(db, { ...exampleSnapshot(), telegram: { chatId: null, threadId: null } });
  [{ id: pl6 }] = await db.select({ id: subunit.id }).from(subunit).where(eq(subunit.name, "PLATOON 6"));
  const byName = async (name: string) => (await db.select({ id: person.id }).from(person).where(and(eq(person.name, name), eq(person.active, true))))[0].id;
  irfan = await byName("IRFAN");
  chunHei = await byName("CHUN HEI");
});
beforeEach(async () => {
  if (!reachable) return;
  jar.clear();
  tg.calls = [];
  await db.delete(wbCard);
  await db.delete(wbRecord);
  await db.delete(wbAudit);
  await db.delete(wbGrant);
  await db.delete(wbMember);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await db.$client.end();
});

const TROOPER = 1001;
const PS = 2001;

/** Act as this Telegram user in the Mini App. */
async function as(tgId: number) {
  jar.clear();
  await signIn({ id: tgId, first_name: `T${tgId}` });
}

/** The Mini App uploading a photo as whoever is signed in: returns the token. */
async function uploadPhoto() {
  const fd = new FormData();
  fd.set("photo", new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], "mc.jpg", { type: "image/jpeg" }));
  const res = await photoRoute(new Request("http://localhost/api/wb/photo", { method: "POST", body: fd }));
  const body = (await res.json()) as { token?: string; error?: string };
  if (!res.ok) throw new Error(body.error);
  return body.token!;
}
const getPhoto = (recordId: string) => fileRoute(new Request(`http://localhost/api/wb/file/${recordId}`), { params: Promise.resolve({ recordId }) });
const mc = { kind: "MC" as const, category: "Respiratory" as const, diagnosis: "ACUTE PHARYNGITIS", startDate: day(0), endDate: day(2), seenBy: null };

/** PTE IRFAN reports sick outside; his PS approves. */
async function approvedRso() {
  await member(TROOPER, irfan);
  await member(PS, chunHei, [{ role: "PS", subunitId: pl6 }]);
  const by = await acting(TROOPER);
  const rec = { ...sickFrom({ where: "RSO", date: day(0), clinic: "raffles medical", symptoms: "Fever" }), personId: irfan, memberId: by.actor.id, createdVia: "SELF" as const };
  const id = ok(await submit(recordingCourier(), by, [rec])).records[0].id;
  await decide(recordingCourier(), await acting(PS), id, "approve");
  return id;
}

describe("medical routes (DB)", () => {
  it("the photo goes to his own DM only, and its token is his alone", async (ctx) => {
    if (!reachable) ctx.skip();
    const rso = await approvedRso();
    await as(TROOPER);
    const token = await uploadPhoto();
    expect(tg.calls.filter((c) => c.method === "sendPhoto").map((c) => c.payload.chat_id)).toEqual([TROOPER]);
    // the PS can't record the trooper's outcome with the trooper's token, nor anyone with a forged one
    await as(PS);
    expect(await medical.recordOutcome({ anchorId: rso, mc, statuses: [], photoToken: token, onensUploaded: false })).toEqual({ ok: false, error: "That photo has expired. Add it again." });
    await as(TROOPER);
    expect(await medical.recordOutcome({ anchorId: rso, mc, statuses: [], photoToken: `${token.split(".")[0]}.forged`, onensUploaded: false })).toMatchObject({ ok: false });
    expect(await medical.recordOutcome({ anchorId: rso, mc, statuses: [], photoToken: token, onensUploaded: false })).toMatchObject({ ok: true, data: { anchorId: rso } });
    // the largest size Telegram returned is what's kept
    expect((await db.select().from(wbRecord).where(eq(wbRecord.parentId, rso)))[0].evidenceFileId).toMatch(/^PHOTO-/);
  });

  it("who sees the diagnosis and photo: the trooper and his PS do (audited); a GC and another platoon's PS don't", async (ctx) => {
    if (!reachable) ctx.skip();
    const rso = await approvedRso();
    await as(TROOPER);
    await medical.recordOutcome({ anchorId: rso, mc, statuses: [], photoToken: await uploadPhoto(), onensUploaded: true });
    const [mcRow] = await db.select().from(wbRecord).where(eq(wbRecord.parentId, rso));
    const view = (await recordView(mcRow.id))!;
    expect(view).not.toHaveProperty("diagnosis");
    expect(view).not.toHaveProperty("evidenceFileId");

    const [slr] = await db.select({ id: camp.id }).from(camp).where(eq(camp.name, "SLR"));
    const gc = await member(3001, null, [{ role: "GC", campId: slr.id }]);
    const otherPs = await member(3002, null, [{ role: "PS", subunitId: (await db.select({ id: subunit.id }).from(subunit).where(eq(subunit.name, "PLATOON 5")))[0].id }]);
    await db.delete(wbAudit);

    for (const who of [3001, 3002]) expect((await readDiagnoses((await acting(who)).actor, [view], "MINIAPP")).size).toBe(0);
    expect(await db.select().from(wbAudit)).toEqual([]);
    expect((await readDiagnoses((await acting(PS)).actor, [view], "MINIAPP")).get(mcRow.id)).toBe("ACUTE PHARYNGITIS");

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } }));
    try {
      for (const tgId of [3001, 3002]) {
        await as(tgId);
        expect((await getPhoto(mcRow.id)).status).toBe(404);
      }
      await as(PS);
      const res = await getPhoto(mcRow.id);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
      expect(String(fetchSpy.mock.calls[0][0])).toMatch(/^https:\/\/api\.telegram\.org\/file\/bot.+\/photos\/file_1\.jpg$/);
      await as(TROOPER);
      expect((await getPhoto(mcRow.id)).status).toBe(200);
    } finally {
      fetchSpy.mockRestore();
    }
    const reads = await db.select({ memberId: wbAudit.memberId, after: wbAudit.after }).from(wbAudit).where(eq(wbAudit.action, "read-medical")).orderBy(wbAudit.at);
    const ps = (await acting(PS)).actor.id;
    const trooper = (await acting(TROOPER)).actor.id;
    expect(reads).toEqual([
      { memberId: ps, after: { field: "diagnosis" } },
      { memberId: ps, after: { field: "photo" } },
      { memberId: trooper, after: { field: "photo" } },
    ]);
    expect(reads.some((r) => r.memberId === gc.id || r.memberId === otherPs.id)).toBe(false);
  });
});
