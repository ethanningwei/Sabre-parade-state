import { featureOff } from "@/lib/flags";
import { getMember } from "@/lib/wb/auth";
import { PHOTO_MAX_BYTES, PHOTO_TYPES, PhotoError, signPhotoToken, storePhoto } from "@/lib/wb/photo";
import { outbound } from "@/lib/wb/telegram/outbound";

// The Mini App's photo of a medical document. Not a server action: those are
// capped at 1 MB, and this keeps v1's next.config.ts untouched. The photo goes
// to the trooper's own DM with the bot and nowhere else; we keep only the
// file_id, handed back inside a signed token the outcome form sends on.
export async function POST(request: Request): Promise<Response> {
  const off = featureOff();
  if (off) return off;

  const member = await getMember();
  if (!member?.registeredAt) return Response.json({ error: "Please reopen Sabre from Telegram." }, { status: 401 });
  if (!member.personId) return Response.json({ error: "Ask your PS to add you to the parade state first." }, { status: 403 });

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > PHOTO_MAX_BYTES + 64 * 1024) return Response.json({ error: "That photo is too big. Try another." }, { status: 413 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("photo");
  if (!(file instanceof File)) return Response.json({ error: "Pick a photo." }, { status: 400 });
  if (!PHOTO_TYPES.includes(file.type)) return Response.json({ error: "That isn't a photo. Use a JPEG or PNG." }, { status: 415 });
  if (file.size > PHOTO_MAX_BYTES) return Response.json({ error: "That photo is too big. Try another." }, { status: 413 });

  try {
    const fileId = await storePhoto(await outbound(), member.telegramUserId, new Uint8Array(await file.arrayBuffer()));
    return Response.json({ token: signPhotoToken(fileId, member.id) });
  } catch (e) {
    if (e instanceof PhotoError) return Response.json({ error: e.message }, { status: 502 });
    console.error("wb photo:", e);
    return Response.json({ error: "Couldn't save the photo. Try again." }, { status: 500 });
  }
}
