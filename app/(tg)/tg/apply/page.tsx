import { BookOpen, Car, FileHeart, Home, Palmtree, Plane, Stethoscope, Thermometer } from "lucide-react";
import { Header } from "@/components/tg/form-bits";
import { NotOnRoster } from "@/components/tg/not-on-roster";
import { Tile } from "@/components/tg/tile";
import { Group } from "@/components/tg/ui";
import { isEnabled, requireFeaturePage } from "@/lib/flags";
import { requireRegistered } from "@/lib/wb/auth";
import { approverOf } from "@/lib/wb/domain/access";
import { rosterSelf } from "@/lib/wb/me";
import { reportsForMen } from "@/lib/wb/report-for";

// Everything a trooper can put on their own timeline, and (2026-10-24) what a
// GC, PS or PC can report for one of his men: shown even when he isn't on
// the roster himself, since Apply is a GC's way in.
export default async function ApplyPage() {
  await requireFeaturePage();
  const member = await requireRegistered();
  const me = await rosterSelf(member);
  const forMen = reportsForMen(member) && (
    <Group title="For one of my men" rows>
      <Tile href="/tg/apply/sick?for=pick" icon={<Thermometer />} title="Report sick for him" hint="He forgot or can't. He's told, and can say it's not right" />
      <Tile href="/tg/apply/ma?for=pick" icon={<Stethoscope />} title="Medical appointment for him" hint="Recorded, no approval needed" />
    </Group>
  );
  const who = approverOf(member.grants.map((g) => g.role));
  const approves = who ? `${who[0].toUpperCase()}${who.slice(1)} approves` : "Recorded, no approval needed";

  return (
    <div className="flex flex-col gap-6">
      <Header title="Apply or report" hint={`You have ${member.leaveLeft ?? 0} days of leave left.`} />
      {!me ? (
        <div className="tg-enter flex flex-col gap-6">
          <NotOnRoster />
          {forMen}
        </div>
      ) : (
        <nav className="tg-enter flex flex-col gap-6">
          <Group title="Medical" rows>
            <Tile href="/tg/apply/sick" icon={<Thermometer />} title="Report sick" hint={`In camp or outside. ${approves}`} />
            <Tile href="/tg/apply/outcome" icon={<FileHeart />} title="Record an MC or status" hint="From a doctor you saw without reporting sick first" />
            <Tile href="/tg/apply/ma" icon={<Stethoscope />} title="Medical appointment" hint="Recorded, no approval needed" />
          </Group>
          {forMen}
          <Group title="Leave and off" rows>
            <Tile href="/tg/apply/al" icon={<Palmtree />} title="Annual leave" hint={`Singapore or Johor Bahru. ${approves}`} />
            <Tile href="/tg/apply/ol" icon={<Plane />} title="Overseas leave" hint={`Anywhere further. ${approves}`} />
            <Tile href="/tg/apply/off" icon={<Home />} title="Off" hint={approves} />
          </Group>
          <Group title="Anything else" rows>
            <Tile href="/tg/apply/event" icon={<BookOpen />} title="Course, brief, IPPT, anything else" hint="Recorded, no approval needed" />
          </Group>
          {isEnabled("CLAIMS") && (
            <Group title="Transport" rows>
              <Tile href="/tg/apply/claim" icon={<Car />} title="Transport claim" hint="Before the trip. The OC approves it on his sheet" />
            </Group>
          )}
        </nav>
      )}
    </div>
  );
}
