import { ArrowLeftRight, Bus, Car, CalendarPlus, CalendarRange, ClipboardList, History, Inbox, ListChecks, Settings, UsersRound } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ParadeStateTile } from "@/components/tg/parade-state-tile";
import { StateChip } from "@/components/tg/record-summary";
import { Tile } from "@/components/tg/tile";
import { Group } from "@/components/tg/ui";
import { isEnabled, requireFeaturePage } from "@/lib/flags";
import { getMember, hasGrant } from "@/lib/wb/auth";
import { KIND_LABEL, recordWhat } from "@/lib/wb/domain/describe";
import { rfAnything } from "@/lib/wb/domain/rf";
import { decidesAnything, forecastsAnything, hotosAnything, proxiesAnything } from "@/lib/wb/domain/rules";
import { place } from "@/lib/wb/format";
import { rosterSelf } from "@/lib/wb/me";
import { profileOf } from "@/lib/wb/members";
import { GAPS_ROLES, PARADE_STATE_ROLES } from "@/lib/wb/permissions";
import { nowAndNext, onensOwedFor, pendingFor, type RecordView } from "@/lib/wb/records";
import { assignmentsOf, openRequests } from "@/lib/wb/rf-data";

// Home: who you are, where you are now and what's next, and the screens you
// can reach. Settings (Shifts, Admin, My details) sit behind the gear.
export default async function TgHome() {
  await requireFeaturePage();
  const member = await getMember();
  if (!member) return null; // the layout is signing them in
  if (!member.registeredAt) redirect("/tg/register");
  const [me, self] = await Promise.all([profileOf(member), rosterSelf(member)]);
  const { current, next } = self ? await nowAndNext(self.personId) : { current: null, next: null };
  const decides = decidesAnything(member.grants);
  const [waiting, owed] = decides ? await Promise.all([pendingFor(member).then((p) => p.length), onensOwedFor(member.grants).then((o) => o.length)]) : [0, 0];

  const hoto = hotosAnything(member.grants);
  const manpower = forecastsAnything(member.grants);
  const rf = rfAnything(member.grants);
  const [openRf, duties] = await Promise.all([rf ? openRequests().then((o) => o.length) : 0, self ? assignmentsOf(self.personId) : []]);
  const parade = hasGrant(member.grants, PARADE_STATE_ROLES, "any");
  const commands = parade || decides || manpower || hoto || rf || proxiesAnything(member.grants) || hasGrant(member.grants, GAPS_ROLES, "any");

  return (
    <div className="flex flex-col gap-6">
      <header className="tg-enter flex flex-col gap-0.5 px-1">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-sm text-muted-foreground">Signed in as</p>
            <h1 className="text-[1.625rem] leading-tight font-semibold tracking-tight">
              {me.rank} {me.name}
            </h1>
            <p className="text-sm text-muted-foreground">{place(me.campName, me.subunitName) || "No camp yet"}</p>
          </div>
          <Link
            href="/tg/settings"
            aria-label="Settings"
            className="tg-press -mr-1 flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground active:bg-muted [&_svg]:size-[22px]"
          >
            <Settings aria-hidden />
          </Link>
        </div>
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

      {duties.length > 0 && (
        <section className="tg-enter" style={{ "--i": 1 } as React.CSSProperties}>
          <Group title="Extra · RF · SOL" rows>
            {duties.map((d) => (
              <p key={d.id} className="px-4 py-3 text-sm">
                <span className="font-medium">{d.line}</span>
                {d.type !== "SOL" && <span className="block text-xs text-muted-foreground">Absent from {d.homeCampName}, counted at {d.campName}</span>}
              </p>
            ))}
          </Group>
        </section>
      )}

      <nav className="tg-enter flex flex-col gap-6" style={{ "--i": 2 } as React.CSSProperties}>
        {self && (
          <Group title="You" rows>
            <Tile href="/tg/apply" icon={<CalendarPlus />} title="Apply or report" hint={`Report sick, MC, leave, off, MA, courses · ${member.leaveLeft ?? 0} days of leave left`} />
            <Tile href="/tg/records" icon={<ListChecks />} title="My records" hint="Everything you've applied for and reported" />
            {isEnabled("CLAIMS") && self && <Tile href="/tg/claims" icon={<Car />} title="Transport claims" hint="Ask before the trip; see what the OC decided" />}
          </Group>
        )}
        {commands && (
          <Group title="Commander" rows>
            {parade && <ParadeStateTile />}
            {manpower && <Tile href="/tg/manpower" icon={<CalendarRange />} title="Manpower" hint="Who's on shift and who's away, today and the next 14 days" />}
            {decides && <Tile href="/tg/inbox" icon={<Inbox />} title="Inbox" badge={waiting + owed} hint="Approvals and ONENS owed" />}
            {hoto && <Tile href="/tg/hoto" icon={<ArrowLeftRight />} title="HOTO" hint="Log a handover" />}
            {rf && <Tile href="/tg/rf" icon={<Bus />} title="RF and duties" badge={openRf} hint="Camps short of men; ask, deploy, or assign Extra, RF or SOL" />}
            {decides && <Tile href="/tg/people" icon={<History />} title="Person history" hint="Anyone's records; void a mistake" />}
            {proxiesAnything(member.grants) && <Tile href="/tg/add" icon={<UsersRound />} title="Add for several men" hint="A course or duty they've been detailed for" />}
            {hasGrant(member.grants, GAPS_ROLES, "any") && <Tile href="/tg/gaps" icon={<ClipboardList />} title="Gaps" hint="Who isn't registered or isn't on the roster" />}
          </Group>
        )}
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
