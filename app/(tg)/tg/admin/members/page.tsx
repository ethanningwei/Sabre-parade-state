import { MembersEditor } from "@/components/tg/admin/members-editor";
import { requireFeaturePage } from "@/lib/flags";
import { listMembers } from "@/lib/wb/admin-data";
import { requireGrantPage } from "@/lib/wb/auth";
import { ADMIN_ROLES } from "@/lib/wb/permissions";

export default async function MembersPage() {
  await requireFeaturePage();
  const me = await requireGrantPage(ADMIN_ROLES);
  const members = await listMembers();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
      <MembersEditor members={members} myId={me.id} />
    </div>
  );
}
