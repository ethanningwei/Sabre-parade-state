"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { assignPastedAction, checkPasteAction } from "@/lib/wb/actions/changeover";
import type { PasteCheck } from "@/lib/wb/changeover-data";
import { BigButton, ErrorBox, Header, useAction } from "../form-bits";
import { Group, textareaClass } from "../ui";

const WHY = { svc: "SVC trooper: leaves at the switch", hq: "COY HQ: stays where he is", twice: "named twice: his first place is kept" } as const;

/**
 * Paste the Telegram list (mockups 4 and 5): read it, check it (matched, not
 * sure, not on the roster, on the roster but not named), pick who each "not
 * sure" name is, then assign. Nothing is saved until Assign.
 */
export function PasteFlow() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [check, setCheck] = useState<PasteCheck | null>(null);
  // "not sure" line → the man picked for it
  const [picks, setPicks] = useState<Map<number, string>>(new Map());
  const { pending, error, call } = useAction();

  if (!check) {
    return (
      <div className="flex flex-col gap-4">
        <Header title="Paste a list" hint="Copy the whole Telegram message and paste it here. Headers like PLATOON 1 and Section 2 say where everyone below them goes." />
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="The message"
          placeholder={"PLATOON 1\nSection 1\n1. 3SG Alpha Tan (SC)\n2. PTE Oscar Lee\n…"}
          className={`${textareaClass} min-h-72 font-mono text-[15px] leading-relaxed`}
          autoCapitalize="off"
          spellCheck={false}
        />
        <div className="flex flex-col gap-1.5 px-1 text-xs text-muted-foreground">
          <p>Rank, numbering, mixed case, a surname only: all fine. Other lines are ignored. Put (SC) after a name to make him the section&apos;s SC.</p>
          <p>Sent in parts? Paste each part. A later paste only changes the men it names.</p>
        </div>
        <ErrorBox error={error} />
        <BigButton pending={pending} missing={text.trim() ? null : "Paste the list first."} onClick={() => call(() => checkPasteAction(text), (c) => (setPicks(new Map()), setCheck(c)))}>
          Read the list
        </BigButton>
      </div>
    );
  }

  const rows = [
    ...check.matched.map((m) => ({ personId: m.person.personId, platoon: m.platoon, section: m.section, sc: m.sc })),
    ...check.unsure.flatMap((u) => (picks.has(u.line) ? [{ personId: picks.get(u.line)!, platoon: u.platoon, section: u.section, sc: u.sc }] : [])),
  ];
  const twice = rows.length !== new Set(rows.map((r) => r.personId)).size;
  const pick = (line: number, personId: string | null) => {
    const next = new Map(picks);
    if (personId && next.get(line) !== personId) next.set(line, personId);
    else next.delete(line);
    setPicks(next);
  };

  return (
    <div className="flex flex-col gap-5 pb-28">
      <Header title="Check the list" hint={`${check.read} names read · ${check.platoons} platoons · ${check.sections} sections`} />
      <div className="grid grid-cols-3 gap-2">
        <Count n={check.matched.length} label="matched" tone="text-present" />
        <Count n={check.unsure.length} label="not sure" tone="text-amber-600 dark:text-amber-400" />
        <Count n={check.missing.length} label="not on roster" tone="text-destructive" />
      </div>

      {check.newStructure.length > 0 && (
        <p className="rounded-xl bg-card px-3 py-2.5 text-sm">
          New in the draft: {check.newStructure.join(", ")}. Assign drafts {check.newStructure.length === 1 ? "it" : "them"}.
        </p>
      )}

      {check.unsure.length > 0 && (
        <Group title={`Not sure · ${check.unsure.length}`} hint="Tap who it is. Leave it to skip that name.">
          <div className="tg-rows overflow-hidden rounded-2xl bg-card">
            {check.unsure.map((u) => (
              <div key={u.line} className="flex flex-col gap-2 px-4 py-3">
                <p className="font-medium">
                  &ldquo;{u.raw}&rdquo;{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    → {u.platoon} · {u.section}
                  </span>
                </p>
                {u.tooMany ? (
                  <p className="text-xs text-muted-foreground">{u.tooMany} men match. Paste it with more of his name.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {u.people.map((p) => {
                      const on = picks.get(u.line) === p.personId;
                      return (
                        <button key={p.personId} type="button" aria-pressed={on} onClick={() => pick(u.line, p.personId)} className={`tg-press min-h-10 rounded-lg border px-3 text-sm font-medium ${on ? "border-primary bg-primary/10 text-primary" : "border-border bg-muted/50 active:bg-muted"}`}>
                          {p.label} · {p.campName}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Group>
      )}

      {check.missing.length > 0 && (
        <Group title={`Not on the roster · ${check.missing.length}`} hint={<>Skipped. Add them on <Link href="/tg/roster" className="text-primary">Roster</Link> (any camp for now), then paste their part again.</>}>
          <div className="tg-rows overflow-hidden rounded-2xl bg-card">
            {check.missing.map((m) => (
              <p key={m.line} className="px-4 py-2.5 text-sm">
                <span className="font-medium">{m.raw}</span>
                <span className="block text-xs text-muted-foreground">
                  {m.platoon} · {m.section}
                </span>
              </p>
            ))}
          </div>
        </Group>
      )}

      {check.skipped.length > 0 && (
        <Group title={`Not placed · ${check.skipped.length}`}>
          <div className="tg-rows overflow-hidden rounded-2xl bg-card">
            {check.skipped.map((s, i) => (
              <p key={i} className="px-4 py-2.5 text-sm">
                <span className="font-medium">{s.label}</span>
                <span className="block text-xs text-muted-foreground">{WHY[s.why]}</span>
              </p>
            ))}
          </div>
        </Group>
      )}

      {check.homeless.length > 0 && (
        <Group title={`No section above them · ${check.homeless.length}`}>
          <p className="px-1 text-sm text-muted-foreground">{check.homeless.join(", ")}. Put a Section header above them and paste again.</p>
        </Group>
      )}

      {check.stillUnplaced.length > 0 && (
        <Group title={`On the roster, not in the list · ${check.stillUnplaced.length}`}>
          <p className="px-1 text-sm leading-relaxed text-muted-foreground">
            {check.stillUnplaced.slice(0, 30).join(", ")}
            {check.stillUnplaced.length > 30 && ` and ${check.stillUnplaced.length - 30} more`} stay without a section. Place them on Sections.
          </p>
        </Group>
      )}

      <ErrorBox error={error ?? (twice ? "You've picked one man for two names. Untick one." : null)} />
      <div className="fixed inset-x-0 bottom-0 z-10 mx-auto flex max-w-2xl flex-col gap-2 bg-gradient-to-t from-background from-70% to-transparent px-4 pt-6 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <BigButton
          pending={pending}
          disabled={twice}
          missing={rows.length ? null : "Nothing to place yet: match at least one name."}
          onClick={() =>
            call(
              () => assignPastedAction(rows),
              (r) => {
                toast.success(`${r.placed} placed${r.created.length ? `, ${r.created.length} new platoons and sections drafted` : ""}.`);
                router.push("/tg/changeover");
              },
            )
          }
        >
          Assign {rows.length}
        </BigButton>
        <button type="button" onClick={() => setCheck(null)} className="tg-press min-h-11 rounded-lg text-sm font-medium text-primary active:bg-muted">
          Back to the list
        </button>
      </div>
    </div>
  );
}

function Count({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <div className="rounded-2xl bg-card px-3 py-2.5">
      <p className={`text-[1.375rem] leading-none font-semibold tabular-nums ${tone}`}>{n}</p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
