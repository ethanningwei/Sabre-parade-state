import { featureOff } from "@/lib/flags";
import { getMember } from "@/lib/wb/auth";
import { readPhoto } from "@/lib/wb/medical";
import { photoBytes } from "@/lib/wb/photo";
import { recordView } from "@/lib/wb/records";
import { outbound } from "@/lib/wb/telegram/outbound";

// A medical document's photo, streamed from Telegram to someone allowed to
// see it (the trooper, his PC/PS, OC/2IC/CSM). Every call is audited in
// readPhoto. Anyone else gets the same 404 as a record with no photo, so the
// route doesn't say what exists. Never cached.
export async function GET(_request: Request, { params }: { params: Promise<{ recordId: string }> }): Promise<Response> {
  const off = featureOff();
  if (off) return off;

  const member = await getMember();
  if (!member?.registeredAt) return new Response("Please reopen Sabre from Telegram.", { status: 401 });
  const { recordId } = await params;
  const notFound = new Response("Not found", { status: 404 });
  if (!/^[0-9a-f-]{36}$/.test(recordId)) return notFound;
  const r = await recordView(recordId);
  if (!r) return notFound;
  const fileId = await readPhoto(member, r);
  if (!fileId) return notFound;

  try {
    const res = await photoBytes(await outbound(), fileId);
    if (!res.ok || !res.body) return new Response("Telegram didn't send the photo. Try again.", { status: 502 });
    return new Response(res.body, {
      headers: {
        "content-type": res.headers.get("content-type")?.startsWith("image/") ? res.headers.get("content-type")! : "image/jpeg",
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (e) {
    // the error names the method, never the token
    console.error("wb file:", e instanceof Error ? e.message : e);
    return new Response("Couldn't fetch the photo. Try again.", { status: 502 });
  }
}
