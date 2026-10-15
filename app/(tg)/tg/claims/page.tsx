import { Car, ExternalLink } from "lucide-react";
import Link from "next/link";
import { Header } from "@/components/tg/form-bits";
import { NotOnRoster } from "@/components/tg/not-on-roster";
import { bigButtonClass, EmptyState, Group } from "@/components/tg/ui";
import { buttonVariants } from "@/components/ui/button";
import { requireFeaturePage } from "@/lib/flags";
import { requireRegistered } from "@/lib/wb/auth";
import { myClaims, readVerdicts, type ClaimView } from "@/lib/wb/claims";
import { roundLabel, type WbClaimState } from "@/lib/wb/domain/claims";
import { dayMonth } from "@/lib/wb/domain/timeline";
import { rosterSelf } from "@/lib/wb/me";
import { claimSheet, claimSheetUrl } from "@/lib/wb/sheets";

// My claims (FEATURE_CLAIMS): what's still with the OC, then the last month's
// verdicts. The OC decides on his sheet; opening this reads it first, so a
// man needn't wait for the evening message. A row deleted on the sheet is
// gone here too: the sheet is the record.

/** Long enough for Google on a good day; the page never waits on a bad one. */
const READ_MS = 4000;

const STATE: Record<WbClaimState, { label: string; cls: string }> = {
  PENDING: { label: "With the OC", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  APPROVED: { label: "Approved", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  REJECTED: { label: "Rejected", cls: "bg-destructive/10 text-destructive" },
  REMOVED: { label: "Removed", cls: "bg-muted text-muted-foreground" },
};

function ClaimRow({ c }: { c: ClaimView }) {
  const s = STATE[c.state];
  return (
    <div className="flex flex-col gap-1 px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="font-medium tabular-nums">{dayMonth(c.tripDate)}</span>
        <span className="flex-1 truncate text-sm text-muted-foreground">{c.vehicle}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>
      </div>
      <p className="text-sm">
        {c.startPlace} → {c.endPlace}
        {roundLabel(c.roundTrip)}
      </p>
      <p className="text-xs text-muted-foreground">{c.reason}</p>
      {c.remarks && <p className="text-sm">OC: {c.remarks}</p>}
      {c.state === "PENDING" && !c.exportedAt && <p className="text-xs text-amber-700 dark:text-amber-300">Not on the OC&apos;s sheet yet. Sabre tries again this evening.</p>}
    </div>
  );
}

export default async function MyClaimsPage() {
  await requireFeaturePage();
  await requireFeaturePage("CLAIMS");
  const member = await requireRegistered();
  const me = await rosterSelf(member);
  if (!me) return <NotOnRoster />;

  let claims = await myClaims(me.personId);
  if (claims.some((c) => c.state === "PENDING" && c.exportedAt)) {
    try {
      const read = readVerdicts(claimSheet());
      read.catch(() => {}); // a late failure after the timeout
      const changed = await Promise.race([read, new Promise<number>((ok) => setTimeout(() => ok(0), READ_MS))]);
      if (changed) claims = await myClaims(me.personId);
    } catch (e) {
      console.error("wb claims read-back:", e);
    }
  }
  const pending = claims.filter((c) => c.state === "PENDING");
  const decided = claims.filter((c) => c.state !== "PENDING");
  const url = claimSheetUrl();

  return (
    <div className="flex flex-col gap-5">
      <Header title="My claims" hint="Transport claims from the last month. The OC decides on his sheet." />
      <Link href="/tg/apply/claim" className={buttonVariants({ size: "lg", className: bigButtonClass })}>
        <Car aria-hidden /> New transport claim
      </Link>
      {url && (
        <a href={url} target="_blank" rel="noreferrer" className={buttonVariants({ size: "lg", variant: "outline", className: bigButtonClass })}>
          <ExternalLink aria-hidden /> Open the OC&apos;s sheet
        </a>
      )}
      {claims.length === 0 ? (
        <EmptyState icon={<Car />} title="No claims yet">
          <p>Ask for a claim before the trip, and the OC&apos;s verdict shows up here.</p>
        </EmptyState>
      ) : (
        <>
          {pending.length > 0 && (
            <Group title="With the OC" rows>
              {pending.map((c) => (
                <ClaimRow key={c.id} c={c} />
              ))}
            </Group>
          )}
          {decided.length > 0 && (
            <Group title="Decided" rows>
              {decided.map((c) => (
                <ClaimRow key={c.id} c={c} />
              ))}
            </Group>
          )}
        </>
      )}
      <p className="px-1 text-xs leading-relaxed text-muted-foreground">Made a mistake? Ask your PS to delete the row on the OC&apos;s sheet (it disappears here too), then send it again.</p>
    </div>
  );
}
