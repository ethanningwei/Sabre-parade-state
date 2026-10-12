import { ChatsEditor } from "@/components/tg/admin/chats-editor";
import { requireFeaturePage } from "@/lib/flags";
import { listCommanderChats } from "@/lib/wb/admin-data";
import { requireGrantPage } from "@/lib/wb/auth";
import { ADMIN_ROLES } from "@/lib/wb/permissions";

export default async function ChatsPage() {
  await requireFeaturePage();
  await requireGrantPage(ADMIN_ROLES);
  const chats = await listCommanderChats();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Commanders&apos; chats</h1>
      <p className="text-sm text-muted-foreground">
        Add the bot to a platoon&apos;s commanders chat (or open the platoon&apos;s topic) and send{" "}
        <code className="font-mono">/here PLATOON 6</code>. It needs PC or PS of that platoon, or an admin.
      </p>
      <ChatsEditor chats={chats.map((c) => ({ ...c, linkedAt: c.linkedAt.toISOString() }))} />
    </div>
  );
}
