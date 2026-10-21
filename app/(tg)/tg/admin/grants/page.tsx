import { GrantsEditor } from "@/components/tg/admin/grants-editor";
import { requireFeaturePage } from "@/lib/flags";
import { listGrants, registeredMembers } from "@/lib/wb/admin-data";
import { requireScreenPage } from "@/lib/wb/auth";
import { structure } from "@/lib/wb/roster";

export default async function GrantsPage() {
  await requireFeaturePage();
  await requireScreenPage("admin");
  const [grants, members, subunits] = await Promise.all([listGrants(), registeredMembers(), structure()]);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Grants</h1>
      <GrantsEditor grants={grants} members={members} structure={subunits} />
    </div>
  );
}
