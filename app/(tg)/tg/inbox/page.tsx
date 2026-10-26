import { CloudCheck } from "lucide-react";
import Link from "next/link";
import { Header } from "@/components/tg/form-bits";
import { InboxZero } from "@/components/tg/inbox-zero";
import { OnensButton } from "@/components/tg/onens-button";
import { RecordActions } from "@/components/tg/record-actions";
import { RecordSummary } from "@/components/tg/record-summary";
import { SwipeToDecide } from "@/components/tg/swipe-to-decide";
import { EmptyState, enter, Segmented } from "@/components/tg/ui";
import { requireFeaturePage } from "@/lib/flags";
import { requireScreenPage } from "@/lib/wb/auth";
import { recordWhat } from "@/lib/wb/domain/describe";
import { recordAccess } from "@/lib/wb/domain/access";
import { decidedToday, onensOwedFor, pendingFor } from "@/lib/wb/records";

// Inbox: what's waiting on this commander, as two tabs (it replaces Approvals
// and ONENS owed, 2026-10-16).
// - Approvals: the same Approve/Reject as the card, for when a platoon has no
//   commanders chat linked or the card has scrolled away.
// - ONENS: MCs from civilian doctors still to go up on ONENS, for the PS/PC
//   (their platoon) and OC/2IC/CSM (everyone). The trooper is reminded each
//   evening; a commander who has checked ONENS can clear it here. No diagnoses.
// Approvals opens first, unless it's empty and ONENS isn't.
export default async function InboxPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  await requireFeaturePage();
  const member = await requireScreenPage("inbox");
  const [pending, owed, decided] = await Promise.all([pendingFor(member), onensOwedFor(member.grants), decidedToday(member.id)]);
  const asked = (await searchParams).tab;
  const onens = asked === "onens" || (asked !== "approvals" && pending.length === 0 && owed.length > 0);

  return (
    <div className="flex flex-col gap-4">
      <Header
        title="Inbox"
        hint={onens ? (owed.length ? `${owed.length} still to upload, oldest first.` : undefined) : pending.length ? `${pending.length} waiting, oldest first. Swipe right to approve, left to reject.` : undefined}
      />
      <Segmented
        label="Inbox"
        items={[
          { href: "/tg/inbox?tab=approvals", label: "Approvals", count: pending.length, on: !onens },
          { href: "/tg/inbox?tab=onens", label: "ONENS", count: owed.length, on: onens },
        ]}
      />
      {onens ? (
        owed.length === 0 ? (
          <EmptyState icon={<CloudCheck />} title="Nothing outstanding on ONENS." />
        ) : (
          owed.map((r, i) => (
            <article key={r.id} className="tg-enter overflow-hidden rounded-2xl bg-card" style={enter(i)}>
              <Link href={`/tg/records/${r.id}`} className="flex flex-col gap-1 p-4 transition-colors duration-150 active:bg-muted">
                <p className="font-medium">
                  {r.rank} {r.name} <span className="font-normal text-muted-foreground">· {r.campName}</span>
                </p>
                <p className="text-sm">{recordWhat(r)}</p>
              </Link>
              <div className="px-4 pb-4">
                <OnensButton recordId={r.id} label="Checked: it's on ONENS" />
              </div>
            </article>
          ))
        )
      ) : pending.length === 0 ? (
        <InboxZero decided={decided} />
      ) : (
        pending.map((r, i) => {
          const can = recordAccess(member, r);
          const card = (
            <RecordSummary r={r} i={i} showWho href={`/tg/records/${r.id}`}>
              <RecordActions recordId={r.id} can={can} />
            </RecordSummary>
          );
          return can.decide ? (
            <SwipeToDecide key={r.id} recordId={r.id} label={`${r.rank} ${r.name}`.trim()}>
              {card}
            </SwipeToDecide>
          ) : (
            <div key={r.id}>{card}</div>
          );
        })
      )}
    </div>
  );
}
