import { CloudCheck } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Header } from "@/components/tg/form-bits";
import { OnensButton } from "@/components/tg/onens-button";
import { EmptyState, enter } from "@/components/tg/ui";
import { requireFeaturePage } from "@/lib/flags";
import { requireRegistered } from "@/lib/wb/auth";
import { recordWhat } from "@/lib/wb/domain/describe";
import { decidesAnything } from "@/lib/wb/domain/rules";
import { onensOwedFor } from "@/lib/wb/records";

// MCs from civilian doctors still to go up on ONENS, for the PS/PC (their
// platoon) and OC/2IC/CSM (everyone). The trooper is reminded each evening;
// a commander who has checked ONENS can clear it here too. No diagnoses.
export default async function OnensPage() {
  await requireFeaturePage();
  const member = await requireRegistered();
  if (!decidesAnything(member.grants)) redirect("/tg");
  const owed = await onensOwedFor(member.grants);

  return (
    <div className="flex flex-col gap-4">
      <Header title="ONENS owed" hint={owed.length ? `${owed.length} still to upload, oldest first.` : undefined} />
      {owed.length === 0 ? (
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
      )}
    </div>
  );
}
