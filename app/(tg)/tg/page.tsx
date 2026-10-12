import { ClipboardList, Settings, UserPen } from "lucide-react";
import { redirect } from "next/navigation";
import { Tile } from "@/components/tg/tile";
import { requireFeature } from "@/lib/flags";
import { getMember, hasGrant } from "@/lib/wb/auth";
import { profileOf } from "@/lib/wb/members";
import { ADMIN_ROLES, GAPS_ROLES } from "@/lib/wb/permissions";

// Home. Phase 1: who you are and the screens you can reach. Where you are and
// what's next arrive with the timeline (Phase 2).
export default async function TgHome() {
  requireFeature();
  const member = await getMember();
  if (!member) return null; // the layout is signing them in
  if (!member.registeredAt) redirect("/tg/register");
  const me = await profileOf(member);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">Signed in as</p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {me.rank} {me.name}
        </h1>
        <p className="text-sm text-muted-foreground">
          {[me.campName, me.subunitName].filter(Boolean).join(" · ") || "No camp yet"}
        </p>
        {!me.onRoster && (
          <p className="mt-2 rounded-lg bg-muted px-3 py-2 text-sm">
            You&apos;re not on the parade state yet. Your PS can see you on Gaps and will add you.
          </p>
        )}
      </header>

      <section className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
        Reporting sick, leave, off and MA are coming here soon.
      </section>

      <nav className="flex flex-col gap-2">
        {hasGrant(member.grants, GAPS_ROLES, "any") && (
          <Tile href="/tg/gaps" icon={<ClipboardList />} title="Gaps" hint="Who isn't registered or isn't on the roster" />
        )}
        {hasGrant(member.grants, ADMIN_ROLES, "any") && (
          <Tile href="/tg/admin" icon={<Settings />} title="Admin" hint="Members, grants, commanders' chats" />
        )}
        <Tile href="/tg/register" icon={<UserPen />} title="My details" hint="Redo your registration" />
      </nav>
    </div>
  );
}
