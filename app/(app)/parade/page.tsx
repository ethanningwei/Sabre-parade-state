import { desc, eq, isNotNull } from "drizzle-orm";
import { ParadeGenerator } from "@/components/parade-generator";
import { SabreLock } from "@/components/sabre-lock";
import { requireViewer } from "@/lib/authz";
import { currentCoy, currentLocked, currentSnapshot } from "@/lib/data/current";
import { db } from "@/lib/db";
import { paradeState, user } from "@/lib/db/schema";
import { currentCaa, validate } from "@/lib/parade";

export default async function ParadePage() {
  const caa = currentCaa();
  const [viewer, coyRow, snapshot, locked, recentSends] = await Promise.all([
    requireViewer(),
    currentCoy(),
    currentSnapshot(),
    currentLocked(),
    db
      .select({
        caaDate: paradeState.caaDate,
        caaTime: paradeState.caaTime,
        sentAt: paradeState.sentAt,
        by: user.name,
      })
      .from(paradeState)
      .leftJoin(user, eq(user.id, paradeState.sentBy))
      .where(isNotNull(paradeState.sentAt))
      .orderBy(desc(paradeState.sentAt))
      .limit(20),
  ]);
  const issues = validate(snapshot, caa);

  const generator = (
    <ParadeGenerator
      defaultCaa={caa}
      initialIssues={issues}
      isAdmin={viewer.role === "admin"}
      telegramReady={Boolean(coyRow.telegramChatId && process.env.TELEGRAM_BOT_TOKEN)}
      recentSends={recentSends.map((s) => ({ caaDate: s.caaDate, caaTime: s.caaTime, sentAt: s.sentAt!.toISOString(), by: s.by }))}
    />
  );
  if (!locked) return generator;
  return (
    <div className="flex flex-col gap-4">
      <SabreLock />
      {generator}
    </div>
  );
}
