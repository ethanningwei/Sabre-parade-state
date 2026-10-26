import { eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { CopyButton } from "@/components/copy-button";
import { requireViewer } from "@/lib/authz";
import { db } from "@/lib/db";
import { paradeState, user } from "@/lib/db/schema";
import { formatSgt } from "@/lib/format";
import { ddmmyy } from "@/lib/parade/time";

export default async function HistoryItemPage({ params }: PageProps<"/history/[id]">) {
  await requireViewer();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const sender = alias(user, "sender");
  const [row] = await db
    .select({ ps: paradeState, generatedBy: user.name, sentBy: sender.name })
    .from(paradeState)
    .leftJoin(user, eq(user.id, paradeState.generatedBy))
    .leftJoin(sender, eq(sender.id, paradeState.sentBy))
    .where(eq(paradeState.id, id));
  if (!row) notFound();

  return (
    <div className="flex flex-col gap-4">
      <Link href="/history" className="-ml-1 inline-flex w-fit items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" /> History
      </Link>
      <div className="px-1">
        <h1 className="text-xl font-semibold tracking-tight">
          CAA {ddmmyy(row.ps.caaDate)} {row.ps.caaTime}H
        </h1>
        <p className="text-sm text-muted-foreground">
          Generated {formatSgt(row.ps.generatedAt)}
          {row.generatedBy ? ` by ${row.generatedBy}` : ""}
          {row.ps.sentAt ? ` · Sent ${formatSgt(row.ps.sentAt)}${row.sentBy ? ` by ${row.sentBy}` : ""}` : " · Not sent"}
        </p>
      </div>
      <CopyButton text={row.ps.text} size="lg" className="h-11" />
      <pre className="overflow-x-auto rounded-2xl bg-card p-4 font-sans text-[14px] leading-relaxed whitespace-pre-wrap">
        {row.ps.text}
      </pre>
    </div>
  );
}
