import { desc, eq } from "drizzle-orm";
import { ChevronRight, Send } from "lucide-react";
import Link from "next/link";
import { requireViewer } from "@/lib/authz";
import { currentCoy } from "@/lib/data/current";
import { db } from "@/lib/db";
import { paradeState, user } from "@/lib/db/schema";
import { formatSgt } from "@/lib/format";
import { ddmmyy } from "@/lib/parade/time";

export default async function HistoryPage() {
  const [, coyRow] = await Promise.all([requireViewer(), currentCoy()]);
  const rows = await db
    .select({
      id: paradeState.id,
      caaDate: paradeState.caaDate,
      caaTime: paradeState.caaTime,
      generatedAt: paradeState.generatedAt,
      sentAt: paradeState.sentAt,
      by: user.name,
      text: paradeState.text,
    })
    .from(paradeState)
    .leftJoin(user, eq(user.id, paradeState.generatedBy))
    .where(eq(paradeState.coyId, coyRow.id))
    .orderBy(desc(paradeState.generatedAt))
    .limit(100);

  const byDay = new Map<string, typeof rows>();
  for (const r of rows) byDay.set(r.caaDate, [...(byDay.get(r.caaDate) ?? []), r]);

  return (
    <div className="flex flex-col gap-5">
      <div className="px-1">
        <h1 className="text-xl font-semibold tracking-tight">History</h1>
        <p className="text-sm text-muted-foreground">Every parade state generated, newest first</p>
      </div>
      {rows.length === 0 && (
        <div className="rounded-2xl bg-card p-8 text-center text-sm text-muted-foreground">
          Nothing generated yet.
        </div>
      )}
      {[...byDay].map(([day, list]) => (
        <section key={day} className="flex flex-col gap-2">
          <h2 className="px-1 text-[0.8125rem] font-medium tracking-wide text-muted-foreground uppercase">{ddmmyy(day)}</h2>
          <ul className="flex flex-col divide-y overflow-hidden rounded-2xl bg-card">
            {list.map((r) => {
              const strength = /^Total Strength: (.+)$/m.exec(r.text)?.[1];
              return (
                <li key={r.id}>
                  <Link href={`/history/${r.id}`} className="flex items-center gap-3 px-3 py-3 hover:bg-muted/50">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        CAA {r.caaTime}H{" "}
                        <span className="font-mono text-sm text-muted-foreground tabular-nums">{strength}</span>
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        Generated {formatSgt(r.generatedAt)}
                        {r.by ? ` by ${r.by}` : ""}
                      </p>
                    </div>
                    {r.sentAt && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-present/12 px-2 py-0.5 text-xs font-medium text-present">
                        <Send className="size-3" /> Sent
                      </span>
                    )}
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
