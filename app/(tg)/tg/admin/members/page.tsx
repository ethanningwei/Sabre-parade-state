import { MembersEditor } from "@/components/tg/admin/members-editor";
import { requireFeaturePage } from "@/lib/flags";
import { listMembers } from "@/lib/wb/admin-data";
import { requireScreenPage } from "@/lib/wb/auth";

export default async function MembersPage() {
  await requireFeaturePage();
  const me = await requireScreenPage("admin");
  const members = await listMembers();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
      <MembersEditor members={members} myId={me.id} />
    </div>
  );
}
