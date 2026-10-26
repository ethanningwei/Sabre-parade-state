import { ArrowLeftRight, Bus, Car, CalendarPlus, CalendarRange, Contact, History, Inbox, ListChecks, Settings, UsersRound } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { NeedsYou } from "@/components/tg/needs-you";
import { StatusPass } from "@/components/tg/status-pass";
import { ParadeStateTile } from "@/components/tg/parade-state-tile";
import { Tile } from "@/components/tg/tile";
import { Group } from "@/components/tg/ui";
import { isEnabled, requireFeaturePage } from "@/lib/flags";
import { toSgt } from "@/lib/parade/time";
import { getMember, type GrantRow } from "@/lib/wb/auth";
import { companyOnly, screens } from "@/lib/wb/domain/access";
import type { GridRow } from "@/lib/wb/domain/forecast";
import { needsYou } from "@/lib/wb/domain/needs-you";
import { isWaiting } from "@/lib/wb/domain/roster-flow";
import { todaySgt } from "@/lib/wb/domain/timeline";
import { waitingCount } from "@/lib/wb/admin-data";
import { campsInfo, forecastScope, grid } from "@/lib/wb/forecast-data";
import { place } from "@/lib/wb/format";
import { rosterSelf } from "@/lib/wb/me";
import { profileOf } from "@/lib/wb/members";
import { paradeIssueCount } from "@/lib/wb/parade-link";
import { currentPhase } from "@/lib/wb/phase";
import { nowAndNext, onensOwedFor, pendingFor, type RecordView } from "@/lib/wb/records";
import { assignmentsOf, openRequests } from "@/lib/wb/rf-data";

// Home: who you are, what needs you (only what you should act on soon, v1's
// blocking parade-state issues included; see lib/wb/domain/needs-you.ts),
// where you are now and what's next, and the screens you can reach. Settings (Shifts, Admin, My details) sit behind the gear.
// In ROT (mockup 9) there are no shifts, minimums, HOTO or RF: those tiles and
// Needs you's "short" line are hidden.
export default async function TgHome() {
  await requireFeaturePage();
  const member = await getMember();
  if (!member) return null; // the layout is signing them in
  if (!member.registeredAt) redirect("/tg/register");
  if (isWaiting(member)) redirect("/tg/waiting");
  const sees = screens(member);
  const rot = (await currentPhase()).phase === "ROT";
  const { inbox: decides, manpower, roster, parade } = sees;
  const hoto = sees.hoto && !rot;
  const rf = sees.rf && !rot;
  const now = new Date();
  const today = todaySgt(now);
  const [[me, self], pending, owed, openRf, short, waiting, paradeIssues] = await Promise.all([
    Promise.all([profileOf(member), rosterSelf(member)]),
    decides ? pendingFor(member) : Promise.resolve([] as RecordView[]),
    decides ? onensOwedFor(member.grants) : Promise.resolve([] as RecordView[]),
    rf ? openRequests(now) : Promise.resolve([]),
    manpower && !rot ? shortSoon(member.grants, today, now) : Promise.resolve([] as GridRow[]),
    roster ? waitingCount(member.grants) : Promise.resolve(0),
    // never breaks Home: no line rather than an error
    parade ? paradeIssueCount(member.grants).catch(() => 0) : Promise.resolve(0),
  ]);
  const [{ current, next }, duties] = await Promise.all([
    self ? nowAndNext(self.personId) : { current: null, next: null },
    self ? assignmentsOf(self.personId) : [],
  ]);
  const needs = needsYou({ pending, short, companyOnly: companyOnly(member), now, today, paradeIssues });
  const commands = parade || decides || manpower || hoto || rf || sees.add || roster;

  return (
    <div className="flex flex-col gap-6">
      <header className="tg-enter flex flex-col gap-0.5 px-1">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-sm text-muted-foreground">{greeting(now)}</p>
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
        <div className="tg-enter" style={{ "--i": 1 } as React.CSSProperties}>
          <StatusPass current={current} next={next} campName={self.campName} leaveLeft={member.leaveLeft ?? null} />
        </div>
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
            <Tile href="/tg/apply" tone="blue" icon={<CalendarPlus />} title="Apply or report" hint={`Report sick, MC, leave, off, MA, courses · ${member.leaveLeft ?? 0} days of leave left`} />
            <Tile href="/tg/records" tone="indigo" icon={<ListChecks />} title="My records" hint="Everything you've applied for and reported" />
            {isEnabled("CLAIMS") && self && <Tile href="/tg/claims" tone="teal" icon={<Car />} title="Transport claims" hint="Ask before the trip; see what the OC decided" />}
          </Group>
        )}
        {commands && (
          <Group title="Commander" rows>
            {parade && <ParadeStateTile tone="green" />}
            {manpower && (
              <Tile
                href="/tg/manpower"
                tone="violet"
                icon={<CalendarRange />}
                title="Manpower"
                hint={rot ? "Who's in and who's away by section, the next 14 days" : "Who's on shift and who's away, today and the next 14 days"}
              />
            )}
            {decides && <Tile href="/tg/inbox" tone="red" icon={<Inbox />} title="Inbox" badge={pending.length + owed.length} hint={inboxHint(pending, owed.length, now)} />}
            {hoto && <Tile href="/tg/hoto" tone="orange" icon={<ArrowLeftRight />} title="HOTO" hint="Log a handover" />}
            {rf && <Tile href="/tg/rf" tone="pink" icon={<Bus />} title="RF and duties" badge={openRf.length} hint={rfHint(openRf.map((r) => r.campName))} />}
            {sees.people && <Tile href="/tg/people" tone="slate" icon={<History />} title="Person history" hint="Anyone's records; void a mistake" />}
            {sees.add && <Tile href="/tg/add" tone="blue" icon={<UsersRound />} title="Add for several men" hint="A course or duty they've been detailed for" />}
            {roster && (
              <Tile
                href="/tg/roster"
                tone="teal"
                icon={<Contact />}
                title="Roster"
                badge={waiting}
                hint={waiting ? `${waiting} waiting to be added to the roster` : rot ? "Add, edit or move men between sections" : "Add, edit or move men on the parade state"}
              />
            )}
          </Group>
        )}
        {commands && rot && (sees.hoto || sees.rf) && <p className="-mt-3 px-1 text-xs text-muted-foreground">Shifts, HOTO, RF and duties are hidden in ROT.</p>}
      </nav>
    </div>
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

/** "Good morning": by the hour in Singapore. */
function greeting(now: Date): string {
  const hour = Number(toSgt(now).time.slice(0, 2));
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}
