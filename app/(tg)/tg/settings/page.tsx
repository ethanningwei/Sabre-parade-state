import { ArrowRightLeft, Clock, Settings, UserPen } from "lucide-react";
import { Header } from "@/components/tg/form-bits";
import { Tile } from "@/components/tg/tile";
import { Group } from "@/components/tg/ui";
import { requireFeaturePage } from "@/lib/flags";
import { requireRegistered } from "@/lib/wb/auth";
import { runsChangeover } from "@/lib/wb/changeover-data";
import { screens } from "@/lib/wb/domain/access";

// Settings, behind the gear on Home (2026-10-16): the screens set up once and
// rarely opened again.
export default async function SettingsPage() {
  await requireFeaturePage();
  const member = await requireRegistered();
  const changeover = await runsChangeover(member);
  return (
    <div className="flex flex-col gap-5">
      <Header title="Settings" />
      <Group rows className="tg-enter">
        {screens(member).shifts && <Tile href="/tg/shifts" icon={<Clock />} title="Shifts" hint="Cycles and minimum manning" />}
        {changeover && <Tile href="/tg/changeover" icon={<ArrowRightLeft />} title="Changeover" hint="Vigilance → ROT: draft the sections, then switch" />}
        {screens(member).admin && <Tile href="/tg/admin" icon={<Settings />} title="Admin" hint="Members, grants, commanders' chats" />}
        <Tile href="/tg/register" icon={<UserPen />} title="My details" hint="Redo your registration" />
      </Group>
    </div>
  );
}
