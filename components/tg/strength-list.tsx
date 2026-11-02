"use client";

import { Check, ChevronDown, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { CopyButton } from "@/components/copy-button";
import { Header } from "./form-bits";
import { Group, inputClass } from "./ui";
import { tick } from "./webapp";
import { DEFAULT_TITLE, strengthGroups, strengthText, TAP_REASONS, type StrengthLine, type StrengthMan, type StrengthTap } from "@/lib/wb/domain/strength-list";

// The strength list's screen: everyone in the camp by role, ✓ or the reason
// Sabre has. Tap a man to say why he isn't going (or that he is after all);
// the message below is what gets copied. Nothing is saved: closing the screen
// forgets the taps.

export function StrengthList({ campName, date, men }: { campName: string; date: string; men: StrengthMan[] }) {
  const [title, setTitle] = useState(DEFAULT_TITLE);
  const [taps, setTaps] = useState<Record<string, StrengthTap>>({});
  const [open, setOpen] = useState<string | null>(null);
  const groups = useMemo(() => strengthGroups(men, taps), [men, taps]);
  const text = strengthText({ date, title, campName, groups });
  const going = groups.reduce((n, g) => n + g.going, 0);

  const tap = (id: string, t: StrengthTap | null) => {
    tick();
    setTaps((all) => {
      const next = { ...all };
      if (t) next[id] = t;
      else delete next[id];
      return next;
    });
    setOpen(null);
  };

  return (
    <div className="flex flex-col gap-5">
      <Header title={`${campName} strength`} hint="Filled in from Sabre. Tap anyone who isn't going, or who is after all, then copy it into Commanders of N23." />
      <label className="flex flex-col gap-1.5">
        <span className="px-1 text-[0.8125rem] font-medium tracking-wide text-muted-foreground uppercase">Conduct</span>
        <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} autoCapitalize="characters" />
      </label>
      {men.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">Nobody is posted to {campName}.</p>
      ) : (
        groups.map((g) => (
          <Group key={g.label} title={g.label} aside={`${g.going}/${g.lines.length} going`} rows>
            {g.lines.map((l) => (
              <Row key={l.man.personId} line={l} open={open === l.man.personId} onToggle={() => setOpen(open === l.man.personId ? null : l.man.personId)} onTap={(t) => tap(l.man.personId, t)} />
            ))}
          </Group>
        ))
      )}
      <Group title="Message">
        <pre className="overflow-x-auto rounded-2xl bg-card p-4 font-mono text-[0.8125rem] leading-relaxed whitespace-pre-wrap">{text}</pre>
      </Group>
      <div className="sticky bottom-[calc(1rem+env(safe-area-inset-bottom))] flex items-center gap-3 rounded-2xl border bg-card/95 p-3 shadow-lg shadow-black/5 backdrop-blur">
        <p className="flex-1 text-sm">
          <span className="text-xl font-semibold tabular-nums">{going}</span>
          <span className="text-muted-foreground tabular-nums">/{men.length} going</span>
        </p>
        <CopyButton text={text} label="Copy strength" className="h-12 rounded-xl px-5 text-base" />
      </div>
    </div>
  );
}

function Row({ line, open, onToggle, onTap }: { line: StrengthLine; open: boolean; onToggle: () => void; onTap: (t: StrengthTap | null) => void }) {
  const [other, setOther] = useState("");
  const { man, going, reason, source } = line;
  // Sabre's "not taking part" (a status) reads amber; away or the GC's own reason, red
  const statusOnly = source === "auto" && !man.away && !!man.status;
  return (
    <div className="flex flex-col">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-h-12 items-center gap-3 px-4 py-2.5 text-left transition-colors duration-150 active:bg-muted">
        <span className="flex-1 font-medium">
          {man.rank} {man.name}
        </span>
        {going ? (
          <Check className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Going" />
        ) : (
          <span
            className={`max-w-[55%] shrink-0 truncate rounded-full px-2.5 py-1 text-xs font-medium ${statusOnly ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" : "bg-destructive/10 text-destructive"}`}
          >
            {reason}
          </span>
        )}
        <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && (
        <div className="flex flex-col gap-2 bg-muted/50 px-4 py-3">
          <p className="text-xs text-muted-foreground">
            {source === "auto" ? `Sabre has him as ${reason}.` : source === "tap" ? "You changed this." : "Why isn't he going?"}
          </p>
          <div className="flex flex-wrap gap-2">
            {!going && <Chip onClick={() => onTap({ going: true })}>Going after all</Chip>}
            {TAP_REASONS.map((r) => (
              <Chip key={r} on={!going && reason === r} onClick={() => onTap({ going: false, reason: r })}>
                {CHIP_LABEL[r]}
              </Chip>
            ))}
            {source === "tap" && (
              <Chip onClick={() => onTap(null)}>
                <RotateCcw className="size-3.5" aria-hidden /> Sabre&apos;s
              </Chip>
            )}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (other.trim()) onTap({ going: false, reason: other });
            }}
          >
            <input className={inputClass} placeholder="Something else: national tennis training" value={other} onChange={(e) => setOther(e.target.value)} />
            <button type="submit" className="tg-press h-12 shrink-0 rounded-xl bg-primary px-4 font-medium text-primary-foreground disabled:opacity-50" disabled={!other.trim()}>
              Set
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

const CHIP_LABEL: Record<(typeof TAP_REASONS)[number], string> = { DRIVING: "Driving", MOUNTING: "Mounting", IPPT: "IPPT", MA: "MA" };

function Chip({ on = false, onClick, children }: { on?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`tg-press inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm ${on ? "border-primary bg-primary/10 font-medium" : "border-border bg-card active:bg-muted"}`}
    >
      {children}
    </button>
  );
}
