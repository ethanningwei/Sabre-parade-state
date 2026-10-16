import { Clock, Settings, UserPen } from "lucide-react";
import { Header } from "@/components/tg/form-bits";
import { Tile } from "@/components/tg/tile";
import { Group } from "@/components/tg/ui";
import { requireFeaturePage } from "@/lib/flags";
import { hasGrant, requireRegistered } from "@/lib/wb/auth";
import { editsShiftsAnything } from "@/lib/wb/domain/rules";
import { ADMIN_ROLES } from "@/lib/wb/permissions";

// Settings, behind the gear on Home (2026-10-16): the screens set up once and
// rarely opened again.
export default async function SettingsPage() {
  await requireFeaturePage();
  const member = await requireRegistered();
  return (
    <div className="flex flex-col gap-5">
      <Header title="Settings" />
      <Group rows className="tg-enter">
        {editsShiftsAnything(member.grants) && <Tile href="/tg/shifts" icon={<Clock />} title="Shifts" hint="Cycles and minimum manning" />}
        {hasGrant(member.grants, ADMIN_ROLES, "any") && <Tile href="/tg/admin" icon={<Settings />} title="Admin" hint="Members, grants, commanders' chats" />}
        <Tile href="/tg/register" icon={<UserPen />} title="My details" hint="Redo your registration" />
      </Group>
    </div>
  );
}
