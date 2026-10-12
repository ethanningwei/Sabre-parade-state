import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { InputFile } from "grammy";
import type { Outbound } from "@/lib/wb/telegram/outbound";

// A medical document's photo lives on Telegram only. The Mini App uploads it
// to /api/wb/photo, which sends it to the trooper's own DM with the bot (his
// copy) and keeps the file_id Telegram hands back. The form then gets a
// short-lived signed token naming that file_id and that member, so the outcome
// it's attached to can only ever carry a photo this same trooper just sent.

/** Vercel caps a request body at 4.5 MB; the client shrinks photos well below this. */
export const PHOTO_MAX_BYTES = 4 * 1024 * 1024;
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const TOKEN_SECONDS = 2 * 60 * 60;

interface PhotoToken {
  f: string;
  m: string;
  exp: number;
}

function key(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new Error("AUTH_SECRET is not set");
  // its own key, so a photo token can never pass as a session cookie or the reverse
  return `wb-photo:${s}`;
}

const mac = (body: string) => createHmac("sha256", key()).update(body).digest("base64url");

export function signPhotoToken(fileId: string, memberId: string, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const body = Buffer.from(JSON.stringify({ f: fileId, m: memberId, exp: nowSeconds + TOKEN_SECONDS } satisfies PhotoToken)).toString("base64url");
  return `${body}.${mac(body)}`;
}

/** The file_id in a token this member was given, or null (forged, someone else's, or expired). */
export function verifyPhotoToken(token: string, memberId: string, nowSeconds = Math.floor(Date.now() / 1000)): string | null {
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const want = Buffer.from(mac(body));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const t = JSON.parse(Buffer.from(body, "base64url").toString()) as PhotoToken;
    return t.m === memberId && t.exp > nowSeconds && typeof t.f === "string" ? t.f : null;
  } catch {
    return null;
  }
}

/**
 * Send the photo to the trooper's own DM and return the largest size's
 * file_id. Throws a readable message when Telegram won't deliver (he has
 * never started the bot, or blocked it).
 */
export async function storePhoto(out: Outbound, telegramUserId: number, bytes: Uint8Array): Promise<string> {
  try {
    const msg = await out.api.sendPhoto(telegramUserId, new InputFile(bytes, "document.jpg"), {
      caption: "📎 Your copy of the medical document you're adding in Sabre. Only you, your PC and PS, and OC, 2IC and CSM can see it there.",
    });
    const largest = msg.photo?.at(-1);
    if (!largest) throw new Error("no photo in the reply");
    return largest.file_id;
  } catch (e) {
    console.error("wb photo:", e);
    throw new PhotoError(`Couldn't send the photo to your chat with @${out.botUsername}. Open that chat, tap Start, then try again.`);
  }
}

export class PhotoError extends Error {}

/** Telegram's file URL for a file_id. Holds the bot token: fetched server-side, never shown. */
export async function photoBytes(out: Outbound, fileId: string): Promise<Response> {
  const file = await out.api.getFile(fileId);
  if (!file.file_path) throw new Error("no file_path");
  return fetch(`https://api.telegram.org/file/bot${out.api.token}/${file.file_path}`);
}
