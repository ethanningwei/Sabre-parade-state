import { ArrowLeftRight, FileText, UserMinus } from "lucide-react";
import { CheckRow } from "@/components/tg/changeover/check-row";
import { SwitchBackPanel, SwitchPanel } from "@/components/tg/changeover/switch-panel";
import { Header } from "@/components/tg/form-bits";
import { Tile } from "@/components/tg/tile";
import { Group } from "@/components/tg/ui";
import { checklist, loadDraft, switchPreview } from "@/lib/wb/changeover-data";
import { dayMonth, todaySgt } from "@/lib/wb/domain/timeline";
import { requireFeaturePage } from "@/lib/flags";
import { requireChangeoverPage } from "@/lib/wb/changeover-page";

// The changeover, Vigilance → ROT (phases-plan §3, mockup 1): what's drafted,
// what's still to do, and Switch to ROT once every man has a section. Nothing
// on the parade state changes until the switch. COY HQ and admins only.
export default async function ChangeoverPage() {
  await requireFeaturePage();
  await requireChangeoverPage();
  const d = await loadDraft();
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  if (d.phase.phase === "ROT") {
    const log = d.phase.changeover?.log;
    const linked = d.platoons.filter((p) => p.chatTitle).length;
    return (
      <div className="flex flex-col gap-6">
        <Header title="Changeover" hint={`In ROT since ${d.phase.changeover ? dayMonth(todaySgt(d.phase.changeover.switchedAt)) : "the switch"}.`} />
        <Group title="The switch" rows>
          <CheckRow state="done" title="Platoons & sections" hint={`${plural(d.platoons.length, "platoon")} · ${plural(d.platoons.reduce((n, p) => n + p.sections.length, 0), "section")}`} />
          <CheckRow state="done" title="Men in sections" hint={`${plural(log?.moves.length ?? 0, "man", "men")} moved · ${plural(log?.removed.length ?? 0, "SVC trooper")} off the roster`} />
          {!!log?.unregistered.length && <CheckRow state="todo" title="No role yet" hint={`${log.unregistered.join(", ")}: no Sabre account at the switch. Give them their role in Admin › Grants once they register.`} />}
          <CheckRow state={linked === d.platoons.length ? "done" : "todo"} title="Commanders' chats" hint={`${linked} of ${plural(d.platoons.length, "platoon")} linked · /here in each new platoon's chat`} />
        </Group>
        <section className="flex flex-col gap-2">
          <SwitchBackPanel />
          <p className="text-center text-xs text-muted-foreground">Meant for the same day, if something is wrong.</p>
        </section>
      </div>
    );
  }
  const c = checklist(d);
  const preview = await switchPreview(d);
  const linked = d.platoons.filter((p) => p.chatTitle).length;

  return (
    <div className="flex flex-col gap-6">
      <Header title="Changeover" hint="Vigilance → ROT. Nothing on the parade state changes until you switch." />

      <Group title="Get ready" rows>
        <CheckRow
          href="/tg/changeover/structure"
          state={c.platoons && c.sections && !c.blockers.some((b) => /no sections|Nobody in/.test(b)) ? "done" : "todo"}
          title="Platoons & sections"
          hint={c.platoons ? `${plural(c.platoons, "platoon")} · ${plural(c.sections, "section")}` : "None drafted yet"}
        />
        <CheckRow
          href="/tg/changeover/sections"
          state={c.toPlace && c.placed === c.toPlace ? "done" : "todo"}
          title="Men in sections"
          hint={c.placed === c.toPlace ? `All ${c.toPlace} placed` : `${c.placed} of ${c.toPlace} · ${c.toPlace - c.placed} still to place`}
        />
        <CheckRow
          href="/tg/changeover/structure"
          state={c.sections && c.sectionsWithSc === c.sections ? "done" : "todo"}
          title="Section commanders"
          hint={`${c.sectionsWithSc} of ${plural(c.sections, "section")} ${c.sectionsWithSc === 1 ? "has" : "have"} an SC`}
        />
        <CheckRow
          href="/tg/changeover/structure"
          state={c.platoons && c.platoonsWithPcPs === c.platoons ? "done" : "todo"}
          title="PCs and PSes"
          hint={c.platoons && c.platoonsWithPcPs === c.platoons ? "Every new platoon has one" : `${c.platoonsWithPcPs} of ${plural(c.platoons, "platoon")} ${c.platoonsWithPcPs === 1 ? "has" : "have"} a PC and a PS`}
        />
        {c.unregistered.length > 0 && (
          <CheckRow state="todo" title="Not registered" hint={`${c.unregistered.join(", ")}: no Sabre account, so the switch can't give ${c.unregistered.length === 1 ? "him his" : "them their"} role. Ask them to register first.`} />
        )}
        <CheckRow
          state="info"
          title="Commanders' chats"
          hint={c.platoons ? `${linked} of ${plural(c.platoons, "platoon")} linked · after the switch, /here in each new chat` : "After the switch, /here in each new platoon's chat"}
        />
      </Group>

      <Group title="Before you switch" rows>
        <Tile href="/tg/changeover/preview" icon={<FileText />} title="Preview the ROT parade state" hint="As it would print right now, from the draft" />
        <Tile href="/tg/changeover/paste" icon={<ArrowLeftRight />} title="Paste the Telegram list" hint="Headers like PLATOON 1 and Section 2 say where everyone goes" />
        <Tile
          href="/tg/changeover/svc"
          icon={<UserMinus />}
          title="SVC troopers leaving"
          hint={c.svc ? `${plural(c.svc, "SVC trooper")} still on the roster. The switch takes them off, as ORD does.` : "None left on the roster"}
        />
      </Group>

      <section className="flex flex-col gap-2">
        {c.blockers.length > 0 && (
          <ul className="flex flex-col gap-1 px-1 text-xs text-muted-foreground">
            {c.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        )}
        <SwitchPanel ready={c.ready} preview={preview} />
        <p className="text-center text-xs text-muted-foreground">{c.ready ? "Ready when you are." : "Unlocks when every man has a section."}</p>
      </section>
    </div>
  );
}
