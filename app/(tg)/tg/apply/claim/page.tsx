import { ClaimForm } from "@/components/tg/apply/claim-form";
import { NotOnRoster } from "@/components/tg/not-on-roster";
import { requireFeaturePage } from "@/lib/flags";
import { requireRegistered } from "@/lib/wb/auth";
import { officeAddress } from "@/lib/wb/domain/claims";
import { todaySgt } from "@/lib/wb/domain/timeline";
import { rosterSelf } from "@/lib/wb/me";
import { claimSheet } from "@/lib/wb/sheets";

// A transport claim, for the man himself only (FEATURE_CLAIMS).
export default async function ApplyClaimPage() {
  await requireFeaturePage();
  await requireFeaturePage("CLAIMS");
  const member = await requireRegistered();
  const me = await rosterSelf(member);
  if (!me) return <NotOnRoster />;
  return <ClaimForm today={todaySgt()} office={officeAddress(me.campName)} sheetReady={claimSheet() !== null} />;
}
