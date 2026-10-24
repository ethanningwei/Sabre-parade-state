import { ArrowLeftRight, FileText, UserMinus } from "lucide-react";
import { CheckRow } from "@/components/tg/changeover/check-row";
import { Header } from "@/components/tg/form-bits";
import { Tile } from "@/components/tg/tile";
import { Group } from "@/components/tg/ui";
import { checklist, loadDraft } from "@/lib/wb/changeover-data";
import { requireFeaturePage } from "@/lib/flags";
import { requireChangeoverPage } from "@/lib/wb/changeover-page";

// The changeover, Vigilance → ROT (phases-plan §3, mockup 1): what's drafted,
// what's still to do, and Switch to ROT once every man has a section. Nothing
// on the parade state changes until the switch. COY HQ and admins only.
export default async function ChangeoverPage() {
  await requireFeaturePage();
  await requireChangeoverPage();
  const d = await loadDraft();
  const c = checklist(d);
  const linked = d.platoons.filter((p) => p.chatTitle).length;
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

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
        <div className="flex min-h-14 items-center gap-3 px-4 py-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive [&_svg]:size-[18px]" aria-hidden>
            <UserMinus />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="font-medium">SVC troopers leaving</span>
            <span className="text-xs leading-snug text-muted-foreground">
              {c.svc ? `${plural(c.svc, "SVC trooper")} still on the roster. The switch takes them off, as ORD does.` : "None left on the roster"}
            </span>
          </span>
        </div>
      </Group>

      <section className="flex flex-col gap-2">
        {c.blockers.length > 0 && (
          <ul className="flex flex-col gap-1 px-1 text-xs text-muted-foreground">
            {c.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        )}
        <button type="button" disabled className="h-12 w-full rounded-xl bg-muted text-base font-medium text-muted-foreground">
          Switch to ROT
        </button>
        <p className="text-center text-xs text-muted-foreground">{c.ready ? "Ready." : "Unlocks when every man has a section."}</p>
      </section>
    </div>
  );
}
