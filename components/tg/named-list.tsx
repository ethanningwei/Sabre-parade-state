"use client";

import { AlertTriangle, Check, Loader2, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import { sendNames } from "@/lib/wb/actions/conducts";
import { byRole, manLine } from "@/lib/wb/domain/named-list";
import { groupLabel, type StrengthMan } from "@/lib/wb/domain/strength-list";
import { toast } from "@/lib/toast";
import { ErrorBox, Header, useAction } from "./form-bits";
import { Group } from "./ui";
import { tick } from "./webapp";

// A camp's names for a named list (slice 3 of docs/conducts-plan.md): its men
// by role, tick who's going. Anyone Sabre has away that day (or on a status)
// says so, and can still be ticked. Send puts the camp on the coy list in
// Commanders of N23 (that one post is edited); sending nobody puts NIL.

export interface NamedSend {
  conductCampId: string;
  title: string;
  /** "Due 110826 1800H" */
  due: string;
  /** "Sent 1912H by 3SG JAYVEN", or null before the first send */
  sent: string | null;
  /** why it can't be sent now (cancelled, the day has passed), or null */
  blocked: string | null;
}

export function NamedList({ campName, men, initialPicked, send, coyText }: { campName: string; men: StrengthMan[]; initialPicked: string[]; send: NamedSend; coyText: string }) {
  const router = useRouter();
  const { pending, error, call } = useAction();
  const [picked, setPicked] = useState<string[]>(initialPicked);
  const [nobody, setNobody] = useState(false);
  const groups = useMemo(() => {
    const out: { label: string; men: StrengthMan[] }[] = [];
    for (const m of byRole(men)) {
      const label = groupLabel(m.role);
      const g = out.find((x) => x.label === label);
      if (g) g.men.push(m);
      else out.push({ label, men: [m] });
    }
    return out;
  }, [men]);
  const chosen = byRole(men.filter((m) => picked.includes(m.personId)));
  const preview = [`${campName}:`, ...(chosen.length ? chosen.map(manLine) : ["NIL"])].join("\n");

  const toggle = (id: string) => {
    tick();
    setNobody(false);
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };

  const submit = (ids: string[]) =>
    call(
      () => sendNames({ conductCampId: send.conductCampId, personIds: ids }),
      (r) => {
        setNobody(false);
        if (r.delivery === "sent") toast.success(r.again ? "Updated on the list in Commanders of N23" : "On the list in Commanders of N23");
        else if (r.delivery === "no-chat") toast.error("Saved. Commanders of N23 isn't linked yet: copy the list in yourself.");
        else toast.error("Saved, but Telegram didn't take it. Copy the list in yourself.");
        router.refresh();
      },
    );

  return (
    <div className="flex flex-col gap-5">
      <Header
        title={`${campName}: who's going`}
        hint={
          <>
            {send.title} · {send.due}
            {send.sent && <span className="block font-medium text-emerald-700 dark:text-emerald-400">{send.sent}</span>}
          </>
        }
      />
      {send.blocked && <p className="rounded-xl bg-muted px-3 py-2.5 text-sm">{send.blocked}</p>}
      {men.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">Nobody is posted to {campName}.</p>
      ) : (
        groups.map((g) => (
          <Group key={g.label} title={g.label} aside={`${g.men.filter((m) => picked.includes(m.personId)).length} picked`} rows>
            {g.men.map((m) => (
              <Row key={m.personId} man={m} on={picked.includes(m.personId)} onToggle={() => toggle(m.personId)} />
            ))}
          </Group>
        ))
      )}
      <Group title="Your camp on the list">
        <pre className="overflow-x-auto rounded-2xl bg-card p-4 font-mono text-[0.8125rem] leading-relaxed whitespace-pre-wrap">{preview}</pre>
      </Group>
      {coyText && <CopyButton text={coyText} label="Copy coy list" variant="outline" className="h-12 rounded-xl text-base" />}
      {!send.blocked && !chosen.length && men.length > 0 && (
        <div className="flex flex-col gap-2 rounded-2xl bg-card p-4">
          <p className="text-sm">{nobody ? `Put ${campName} down as NIL?` : `Nobody from ${campName} is going?`}</p>
          <Button variant="outline" size="lg" className="tg-press h-12 rounded-xl text-base" disabled={pending} onClick={() => (nobody ? submit([]) : setNobody(true))}>
            {nobody ? "Yes, send NIL" : `Nobody from ${campName}`}
          </Button>
        </div>
      )}
      <ErrorBox error={error} />
      <div className="sticky bottom-[calc(1rem+env(safe-area-inset-bottom))] flex items-center gap-3 rounded-2xl border bg-card/95 p-3 shadow-lg shadow-black/5 backdrop-blur">
        <p className="flex-1 text-sm">
          <span className="text-xl font-semibold tabular-nums">{chosen.length}</span>
          <span className="text-muted-foreground"> picked</span>
        </p>
        <Button
          size="lg"
          className="tg-press h-12 rounded-xl px-5 text-base"
          disabled={pending || !!send.blocked || !chosen.length}
          aria-busy={pending}
          onClick={() => submit(chosen.map((m) => m.personId))}
        >
          {pending ? <Loader2 className="animate-spin" /> : <Send aria-hidden />}
          {send.sent ? "Send again" : "Send"}
        </Button>
      </div>
    </div>
  );
}

function Row({ man, on, onToggle }: { man: StrengthMan; on: boolean; onToggle: () => void }) {
  const warn = man.away ?? man.status;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      onClick={onToggle}
      className="flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-150 active:bg-muted"
    >
      <span className={`flex size-6 shrink-0 items-center justify-center rounded-md border ${on ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
        {on && <Check className="size-4" aria-hidden />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-medium">
          {man.rank} {man.name}
        </span>
        {warn && (
          <span className="flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400">
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">
              {warn} · {man.away ? (on ? "picked though away" : "away that day") : on ? "picked though on status" : "on status"}
            </span>
          </span>
        )}
      </span>
    </button>
  );
}
