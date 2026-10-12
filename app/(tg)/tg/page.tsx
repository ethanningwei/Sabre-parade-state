import { CalendarPlus, ClipboardCheck, ClipboardList, CloudUpload, History, ListChecks, Settings, UserPen, UsersRound } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { StateChip } from "@/components/tg/record-summary";
import { Tile } from "@/components/tg/tile";
import { requireFeaturePage } from "@/lib/flags";
import { getMember, hasGrant } from "@/lib/wb/auth";
import { KIND_LABEL, recordWhat } from "@/lib/wb/domain/describe";
import { decidesAnything, proxiesAnything } from "@/lib/wb/domain/rules";
import { place } from "@/lib/wb/format";
import { rosterSelf } from "@/lib/wb/me";
import { profileOf } from "@/lib/wb/members";
import { ADMIN_ROLES, GAPS_ROLES } from "@/lib/wb/permissions";
import { nowAndNext, onensOwedFor, pendingFor, type RecordView } from "@/lib/wb/records";

// Home: who you are, where you are now and what's next, and the screens you can reach.
export default async function TgHome() {
  await requireFeaturePage();
  const member = await getMember();
  if (!member) return null; // the layout is signing them in
  if (!member.registeredAt) redirect("/tg/register");
  const [me, self] = await Promise.all([profileOf(member), rosterSelf(member)]);
  const { current, next } = self ? await nowAndNext(self.personId) : { current: null, next: null };
  const decides = decidesAnything(member.grants);
  const [waiting, owed] = decides ? await Promise.all([pendingFor(member.grants).then((p) => p.length), onensOwedFor(member.grants).then((o) => o.length)]) : [0, 0];

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">Signed in as</p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {me.rank} {me.name}
        </h1>
        <p className="text-sm text-muted-foreground">{place(me.campName, me.subunitName) || "No camp yet"}</p>
        {!me.onRoster && (
          <p className="mt-2 rounded-lg bg-muted px-3 py-2 text-sm">
            You&apos;re not on the parade state yet. Your PS can see you on Gaps and will add you.
          </p>
        )}
      </header>

      {self && (
        <section className="grid grid-cols-2 gap-2">
          <Slot label="Now" r={current} empty="Present" />
          <Slot label="Next" r={next} empty="Nothing coming up" />
        </section>
      )}

      <nav className="flex flex-col gap-2">
        {self && <Tile href="/tg/apply" icon={<CalendarPlus />} title="Apply or report" hint={`Report sick, MC, leave, off, MA, courses · ${member.leaveLeft ?? 0} days of leave left`} />}
        {self && <Tile href="/tg/records" icon={<ListChecks />} title="My records" hint="Everything you've applied for and reported" />}
        {decides && <Tile href="/tg/approvals" icon={<ClipboardCheck />} title={waiting ? `Approvals · ${waiting}` : "Approvals"} hint="Requests waiting on you" />}
        {decides && <Tile href="/tg/onens" icon={<CloudUpload />} title={owed ? `ONENS owed · ${owed}` : "ONENS owed"} hint="Civilian MCs not uploaded yet" />}
        {decides && <Tile href="/tg/people" icon={<History />} title="Person history" hint="Anyone's records; void a mistake" />}
        {proxiesAnything(member.grants) && <Tile href="/tg/add" icon={<UsersRound />} title="Add for several men" hint="A course or duty they've been detailed for" />}
        {hasGrant(member.grants, GAPS_ROLES, "any") && (
          <Tile href="/tg/gaps" icon={<ClipboardList />} title="Gaps" hint="Who isn't registered or isn't on the roster" />
        )}
        {hasGrant(member.grants, ADMIN_ROLES, "any") && <Tile href="/tg/admin" icon={<Settings />} title="Admin" hint="Members, grants, commanders' chats" />}
        <Tile href="/tg/register" icon={<UserPen />} title="My details" hint="Redo your registration" />
      </nav>
    </div>
  );
}

function Slot({ label, r, empty }: { label: string; r: RecordView | null; empty: string }) {
  const inner = (
    <>
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</span>
      {r ? (
        <>
          <span className="font-medium">{KIND_LABEL[r.kind]}</span>
          <span className="text-xs text-muted-foreground">{recordWhat(r)}</span>
          {r.state === "PENDING" && <StateChip state={r.state} />}
        </>
      ) : (
        <span className="font-medium">{empty}</span>
      )}
    </>
  );
  const cls = "flex min-h-24 flex-col gap-1 rounded-xl border bg-card p-3";
  return r ? (
    <Link href={`/tg/records/${r.id}`} className={`${cls} active:bg-muted`}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}
