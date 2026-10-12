import { BookOpen, FileHeart, Home, Palmtree, Plane, Stethoscope, Thermometer } from "lucide-react";
import { Header } from "@/components/tg/form-bits";
import { NotOnRoster } from "@/components/tg/not-on-roster";
import { Tile } from "@/components/tg/tile";
import { requireFeaturePage } from "@/lib/flags";
import { requireRegistered } from "@/lib/wb/auth";
import { rosterSelf } from "@/lib/wb/me";

// Everything a trooper can put on their own timeline.
export default async function ApplyPage() {
  await requireFeaturePage();
  const member = await requireRegistered();
  const me = await rosterSelf(member);

  return (
    <div className="flex flex-col gap-5">
      <Header title="Apply or report" hint={`You have ${member.leaveLeft ?? 0} days of leave left.`} />
      {!me ? (
        <NotOnRoster />
      ) : (
        <nav className="flex flex-col gap-2">
          <Tile href="/tg/apply/sick" icon={<Thermometer />} title="Report sick" hint="In camp or outside. Your PC or PS approves" />
          <Tile href="/tg/apply/outcome" icon={<FileHeart />} title="Record an MC or status" hint="From a doctor you saw without reporting sick first" />
          <Tile href="/tg/apply/al" icon={<Palmtree />} title="Annual leave" hint="Singapore or Johor Bahru. Your PC or PS approves" />
          <Tile href="/tg/apply/ol" icon={<Plane />} title="Overseas leave" hint="Anywhere further. Your PC or PS approves" />
          <Tile href="/tg/apply/off" icon={<Home />} title="Off" hint="Your PC or PS approves" />
          <Tile href="/tg/apply/ma" icon={<Stethoscope />} title="Medical appointment" hint="Recorded, no approval needed" />
          <Tile href="/tg/apply/event" icon={<BookOpen />} title="Course, brief, IPPT, anything else" hint="Recorded, no approval needed" />
        </nav>
      )}
    </div>
  );
}
