import { ArrowLeftRight, CalendarDays, CalendarPlus, CalendarRange, ClipboardCheck, ClipboardList, Clock, CloudUpload, History, ListChecks, Settings, UserPen, UsersRound } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { StateChip } from "@/components/tg/record-summary";
import { Tile } from "@/components/tg/tile";
import { Group } from "@/components/tg/ui";
import { requireFeaturePage } from "@/lib/flags";
import { getMember, hasGrant } from "@/lib/wb/auth";
import { KIND_LABEL, recordWhat } from "@/lib/wb/domain/describe";
import { decidesAnything, editsShiftsAnything, hotosAnything, proxiesAnything } from "@/lib/wb/domain/rules";
import { todaySgt } from "@/lib/wb/domain/timeline";
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

  const hoto = hotosAnything(member.grants);
  const shifts = editsShiftsAnything(member.grants);
  const commands = decides || hoto || shifts || proxiesAnything(member.grants) || hasGrant(member.grants, GAPS_ROLES, "any");

  return (
    <div className="flex flex-col gap-6">
      <header className="tg-enter flex flex-col gap-0.5 px-1">
        <p className="text-sm text-muted-foreground">Signed in as</p>
        <h1 className="text-[1.625rem] leading-tight font-semibold tracking-tight">
          {me.rank} {me.name}
        </h1>
        <p className="text-sm text-muted-foreground">{place(me.campName, me.subunitName) || "No camp yet"}</p>
        {!me.onRoster && (
          <p className="mt-2 rounded-xl bg-card px-3 py-2.5 text-sm">
            You&apos;re not on the parade state yet. Your PS can see you on Gaps and will add you.
          </p>
        )}
      </header>

      {self && (
        <section className="tg-enter grid grid-cols-2 gap-2.5" style={{ "--i": 1 } as React.CSSProperties}>
          <Slot label="Now" r={current} empty="Present" />
          <Slot label="Next" r={next} empty="Nothing coming up" />
        </section>
      )}

      <nav className="tg-enter flex flex-col gap-6" style={{ "--i": 2 } as React.CSSProperties}>
        {self && (
          <Group title="You" rows>
            <Tile href="/tg/apply" icon={<CalendarPlus />} title="Apply or report" hint={`Report sick, MC, leave, off, MA, courses · ${member.leaveLeft ?? 0} days of leave left`} />
            <Tile href="/tg/records" icon={<ListChecks />} title="My records" hint="Everything you've applied for and reported" />
          </Group>
        )}
        {commands && (
          <Group title="Commander" rows>
            {decides && <Tile href="/tg/approvals" icon={<ClipboardCheck />} title="Approvals" badge={waiting} hint="Requests waiting on you" />}
            {decides && <Tile href="/tg/onens" icon={<CloudUpload />} title="ONENS owed" badge={owed} hint="Civilian MCs not uploaded yet" />}
            {decides && <Tile href={`/tg/day/${todaySgt()}`} icon={<CalendarDays />} title="Today" hint="Who's on shift, who's away, who's on status" />}
            {decides && <Tile href="/tg/forecast" icon={<CalendarRange />} title="Forecast" hint="The next 14 days against minimum manning" />}
            {hoto && <Tile href="/tg/hoto" icon={<ArrowLeftRight />} title="HOTO" hint="Log a handover" />}
            {decides && <Tile href="/tg/people" icon={<History />} title="Person history" hint="Anyone's records; void a mistake" />}
            {proxiesAnything(member.grants) && <Tile href="/tg/add" icon={<UsersRound />} title="Add for several men" hint="A course or duty they've been detailed for" />}
            {hasGrant(member.grants, GAPS_ROLES, "any") && <Tile href="/tg/gaps" icon={<ClipboardList />} title="Gaps" hint="Who isn't registered or isn't on the roster" />}
          </Group>
        )}
        <Group title="Settings" rows>
          {shifts && <Tile href="/tg/shifts" icon={<Clock />} title="Shifts" hint="Cycles and minimum manning" />}
          {hasGrant(member.grants, ADMIN_ROLES, "any") && <Tile href="/tg/admin" icon={<Settings />} title="Admin" hint="Members, grants, commanders' chats" />}
          <Tile href="/tg/register" icon={<UserPen />} title="My details" hint="Redo your registration" />
        </Group>
      </nav>
    </div>
  );
}

function Slot({ label, r, empty }: { label: string; r: RecordView | null; empty: string }) {
  const inner = (
    <>
      <span className="text-[0.6875rem] font-semibold tracking-wider text-muted-foreground uppercase">{label}</span>
      {r ? (
        <>
          <span className="leading-snug font-semibold">{KIND_LABEL[r.kind]}</span>
          <span className="text-xs leading-snug text-muted-foreground">{recordWhat(r)}</span>
          {r.state === "PENDING" && (
            <span className="mt-auto pt-1">
              <StateChip state={r.state} />
            </span>
          )}
        </>
      ) : (
        <span className="leading-snug font-semibold">{empty}</span>
      )}
    </>
  );
  const cls = "flex min-h-26 flex-col gap-1 rounded-2xl bg-card p-3.5";
  return r ? (
    <Link href={`/tg/records/${r.id}`} className={`${cls} tg-press active:bg-muted`}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}
