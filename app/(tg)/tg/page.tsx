import { ArrowLeftRight, Bus, Car, CalendarPlus, CalendarRange, Contact, History, Inbox, ListChecks, Settings, UsersRound } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { NeedsYou } from "@/components/tg/needs-you";
import { ParadeStateTile } from "@/components/tg/parade-state-tile";
import { StateChip } from "@/components/tg/record-summary";
import { Tile } from "@/components/tg/tile";
import { Group } from "@/components/tg/ui";
import { isEnabled, requireFeaturePage } from "@/lib/flags";
import { getMember, hasGrant, type GrantRow } from "@/lib/wb/auth";
import { KIND_LABEL, recordWhat } from "@/lib/wb/domain/describe";
import type { GridRow } from "@/lib/wb/domain/forecast";
import { needsYou } from "@/lib/wb/domain/needs-you";
import { isWaiting, seesRoster } from "@/lib/wb/domain/roster-flow";
import { rfAnything } from "@/lib/wb/domain/rf";
import { COMPANY_DECIDERS, decidesAnything, forecastsAnything, hotosAnything, PLATOON_DECIDERS, proxiesAnything } from "@/lib/wb/domain/rules";
import { todaySgt } from "@/lib/wb/domain/timeline";
import { waitingCount } from "@/lib/wb/admin-data";
import { campsInfo, forecastScope, grid } from "@/lib/wb/forecast-data";
import { place } from "@/lib/wb/format";
import { rosterSelf } from "@/lib/wb/me";
import { profileOf } from "@/lib/wb/members";
import { paradeIssueCount } from "@/lib/wb/parade-link";
import { PARADE_STATE_ROLES } from "@/lib/wb/permissions";
import { nowAndNext, onensOwedFor, pendingFor, type RecordView } from "@/lib/wb/records";
import { assignmentsOf, openRequests } from "@/lib/wb/rf-data";

// Home: who you are, what needs you (only what you should act on soon, v1's
// blocking parade-state issues included; see lib/wb/domain/needs-you.ts),
// where you are now and what's next, and the screens you can reach. Settings (Shifts, Admin, My details) sit behind the gear.
export default async function TgHome() {
  await requireFeaturePage();
  const member = await getMember();
  if (!member) return null; // the layout is signing them in
  if (!member.registeredAt) redirect("/tg/register");
  if (isWaiting(member)) redirect("/tg/waiting");
  const decides = decidesAnything(member.grants);
  const hoto = hotosAnything(member.grants);
  const manpower = forecastsAnything(member.grants);
  const rf = rfAnything(member.grants);
  const roster = seesRoster(member.grants);
  const now = new Date();
  const today = todaySgt(now);
  const parade = hasGrant(member.grants, PARADE_STATE_ROLES, "any");
  const [[me, self], pending, owed, openRf, short, waiting, paradeIssues] = await Promise.all([
    Promise.all([profileOf(member), rosterSelf(member)]),
    decides ? pendingFor(member) : Promise.resolve([] as RecordView[]),
    decides ? onensOwedFor(member.grants) : Promise.resolve([] as RecordView[]),
    rf ? openRequests(now) : Promise.resolve([]),
    manpower ? shortSoon(member.grants, today, now) : Promise.resolve([] as GridRow[]),
    roster ? waitingCount(member.grants) : Promise.resolve(0),
    // never breaks Home: no line rather than an error
    parade ? paradeIssueCount(member.grants).catch(() => 0) : Promise.resolve(0),
  ]);
  const [{ current, next }, duties] = await Promise.all([
    self ? nowAndNext(self.personId) : { current: null, next: null },
    self ? assignmentsOf(self.personId) : [],
  ]);
  const companyOnly = hasGrant(member.grants, COMPANY_DECIDERS, "company") && !hasGrant(member.grants, PLATOON_DECIDERS, "any");
  const needs = needsYou({ pending, short, companyOnly, now, today, paradeIssues });
  const commands = parade || decides || manpower || hoto || rf || proxiesAnything(member.grants) || roster;

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
        {/* only grant holders get here without a roster person; everyone else waits on /tg/waiting */}
        {!me.onRoster && (
          <p className="mt-2 rounded-xl bg-card px-3 py-2.5 text-sm">
            You&apos;re not on the parade state yourself. Your PS can see you on Roster and add you.
          </p>
        )}
      </header>

      <NeedsYou lines={needs} />

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
            {decides && <Tile href="/tg/inbox" icon={<Inbox />} title="Inbox" badge={pending.length + owed.length} hint={inboxHint(pending, owed.length, now)} />}
            {hoto && <Tile href="/tg/hoto" icon={<ArrowLeftRight />} title="HOTO" hint="Log a handover" />}
            {rf && <Tile href="/tg/rf" icon={<Bus />} title="RF and duties" badge={openRf.length} hint={rfHint(openRf.map((r) => r.campName))} />}
            {decides && <Tile href="/tg/people" icon={<History />} title="Person history" hint="Anyone's records; void a mistake" />}
            {proxiesAnything(member.grants) && <Tile href="/tg/add" icon={<UsersRound />} title="Add for several men" hint="A course or duty they've been detailed for" />}
            {roster && (
              <Tile
                href="/tg/roster"
                icon={<Contact />}
                title="Roster"
                badge={waiting}
                hint={waiting ? `${waiting} waiting to be added to the roster` : "Add, edit or move men on the parade state"}
              />
            )}
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

/** Today's and tomorrow's strength for the member's guardrooms, for the Needs you card. Never breaks Home. */
async function shortSoon(grants: readonly GrantRow[], today: string, now: Date): Promise<GridRow[]> {
  const ids = forecastScope(grants, await campsInfo())
    .filter((c) => !c.isHq)
    .map((c) => c.id);
  return ids.length ? grid(ids, today, 2, now).catch(() => []) : [];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** "3 to approve · oldest 2 days · 1 ONENS owed": only what's there; else what the screen is for. */
function inboxHint(pending: readonly RecordView[], owed: number, now: Date): string {
  const parts: string[] = [];
  if (pending.length) {
    const days = Math.floor((now.getTime() - Math.min(...pending.map((r) => r.createdAt.getTime()))) / DAY_MS);
    parts.push(`${pending.length} to approve`, days === 0 ? "oldest today" : `oldest ${days} day${days === 1 ? "" : "s"}`);
  }
  if (owed) parts.push(`${owed} ONENS owed`);
  return parts.length ? parts.join(" · ") : "Approvals and ONENS owed";
}

/** "SLR and BDK asking for men", "SLR +2 asking for men"; else what the screen is for. */
function rfHint(camps: readonly string[]): string {
  const names = [...new Set(camps)];
  if (!names.length) return "Camps short of men; ask, deploy, or assign Extra, RF or SOL";
  return `${names.length <= 2 ? names.join(" and ") : `${names[0]} +${names.length - 1}`} asking for men`;
}
