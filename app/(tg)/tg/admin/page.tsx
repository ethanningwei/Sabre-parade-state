import { KeyRound, MessagesSquare, Users } from "lucide-react";
import { Header } from "@/components/tg/form-bits";
import { Tile } from "@/components/tg/tile";
import { Group } from "@/components/tg/ui";
import { requireFeaturePage } from "@/lib/flags";
import { requireGrantPage } from "@/lib/wb/auth";
import { ADMIN_ROLES } from "@/lib/wb/permissions";

export default async function AdminHome() {
  await requireFeaturePage();
  await requireGrantPage(ADMIN_ROLES);
  return (
    <div className="flex flex-col gap-4">
      <Header title="Admin" />
      <nav className="tg-enter">
        <Group rows>
          <Tile href="/tg/admin/members" icon={<Users />} title="Members" hint="Link to the roster, unlink, deactivate" />
          <Tile href="/tg/admin/grants" icon={<KeyRound />} title="Grants" hint="Who is PS, PC, OC… and where" />
          <Tile href="/tg/admin/chats" icon={<MessagesSquare />} title="Commanders' chats" hint="Linked with /here" />
        </Group>
      </nav>
    </div>
  );
}
