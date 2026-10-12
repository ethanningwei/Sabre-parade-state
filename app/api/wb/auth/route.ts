import { featureOff } from "@/lib/flags";
import { signIn, verifyInitData } from "@/lib/wb/auth";

// The Mini App posts Telegram's signed initData here; a valid one gets a
// wb_session cookie. Body: { initData: string }.
export async function POST(request: Request): Promise<Response> {
  const off = featureOff();
  if (off) return off;

  const token = process.env.WB_BOT_TOKEN;
  if (!token) return Response.json({ error: "WB_BOT_TOKEN is not set" }, { status: 500 });

  const body = (await request.json().catch(() => null)) as { initData?: unknown } | null;
  const verified = typeof body?.initData === "string" ? verifyInitData(body.initData, token) : null;
  if (!verified) return Response.json({ error: "Please reopen Sabre from Telegram." }, { status: 401 });

  const member = await signIn(verified.user);
  return Response.json({ registered: !!member.registeredAt, startParam: verified.startParam });
}
