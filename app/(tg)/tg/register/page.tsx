import { RegisterFlow } from "@/components/tg/register-flow";
import { ddmmyy } from "@/lib/parade/time";
import { requireFeature } from "@/lib/flags";
import { requireMember } from "@/lib/wb/auth";
import { structure } from "@/lib/wb/roster";

// Registration, and redoing it. Confirm, not fill: rank, camp and platoon come from the roster.
export default async function RegisterPage() {
  requireFeature();
  const [member, subunits] = await Promise.all([requireMember(), structure()]);
  return (
    <RegisterFlow
      structure={subunits}
      initial={{
        fullName: member.fullName ?? "",
        nric: member.nric4 ?? "",
        ord: member.ordDate ? ddmmyy(member.ordDate) : "",
        leaveLeft: member.leaveLeft?.toString() ?? "",
        stayout: member.stayout,
        stayoutUntil: member.stayoutUntil ? ddmmyy(member.stayoutUntil) : "",
      }}
    />
  );
}
