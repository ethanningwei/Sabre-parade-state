import { KeyRound, MessagesSquare, Users } from "lucide-react";
import { Tile } from "@/components/tg/tile";
import { requireFeature } from "@/lib/flags";
import { requireGrantPage } from "@/lib/wb/auth";
import { ADMIN_ROLES } from "@/lib/wb/permissions";

export default async function AdminHome() {
  requireFeature();
  await requireGrantPage(ADMIN_ROLES);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
      <nav className="flex flex-col gap-2">
        <Tile href="/tg/admin/members" icon={<Users />} title="Members" hint="Link to the roster, unlink, deactivate" />
        <Tile href="/tg/admin/grants" icon={<KeyRound />} title="Grants" hint="Who is PS, PC, OC… and where" />
        <Tile href="/tg/admin/chats" icon={<MessagesSquare />} title="Commanders' chats" hint="Linked with /here" />
      </nav>
    </div>
  );
}
