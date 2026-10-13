"use client";

import { AlertTriangle, Check, CircleSlash, Moon, Search, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { deployMan } from "@/lib/wb/actions/rf";
import { fits, type RfRole } from "@/lib/wb/domain/rf";
import { BigLink, Choice, DoneScreen, ErrorBox, useAction } from "../form-bits";
import { fieldClass } from "../ui";

// Pick a man to send. The server ranks them (can go, fits the role, his camp
// is off, nothing in the way, his camp stays above minimum); this filters and sends.

export interface DeployItem {
  personId: string;
  rank: string;
  name: string;
  campName: string;
  role: string;
  away: string[];
  refusal: string | null;
  manning: string | null;
  short: boolean;
  free: boolean;
}

const SHOW_MAX = 60;

export function DeployList({ requestId, want, wantLabel, short, people }: { requestId: string; want: RfRole; wantLabel: string; short: number; people: DeployItem[] }) {
  const router = useRouter();
  // nobody on the roster carries that role (roles left blank): start with everyone rather than an empty list
  const [all, setAll] = useState(want === "ANY" || !people.some((p) => !p.refusal && fits(want, p.role)));
  const [q, setQ] = useState("");
  const [sending, setSending] = useState<string | null>(null);
  const [left, setLeft] = useState(short);
  const { pending, error, call } = useAction();

  if (left <= 0) {
    return (
      <DoneScreen title="Filled" line="Every copy of the card now says FILLED. The men sent have been told, and so have their platoons.">
        <BigLink href={`/tg/rf/${requestId}`}>Open the request</BigLink>
        <BigLink href="/tg/rf" outline>
          RF board
        </BigLink>
      </DoneScreen>
    );
  }

  const query = q.trim().toUpperCase();
  const hits = people.filter((p) => (all || fits(want, p.role)) && (!query || `${p.rank} ${p.name} ${p.campName}`.toUpperCase().includes(query)));
  const shown = hits.slice(0, SHOW_MAX);

  return (
    <div className="flex flex-col gap-3">
      {want !== "ANY" && (
        <div className="grid grid-cols-2 gap-2">
          <Choice on={!all} onClick={() => setAll(false)}>
            {wantLabel} only
          </Choice>
          <Choice on={all} onClick={() => setAll(true)}>
            Everyone
          </Choice>
        </div>
      )}
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or camp" aria-label="Search name or camp" className={`${fieldClass} pl-10`} autoCapitalize="characters" />
      </div>
      <p className="px-1 text-xs text-muted-foreground" aria-live="polite">
        {hits.length > SHOW_MAX ? `Showing ${SHOW_MAX} of ${hits.length}. Type more of a name.` : `${hits.length} people`} · best first
      </p>
      <ErrorBox error={error} />
      {shown.length === 0 && (
        <p className="flex items-center gap-2 rounded-2xl bg-card px-4 py-6 text-sm text-muted-foreground">
          <Users className="size-4" aria-hidden /> Nobody you can send{all ? "" : ` as ${wantLabel}`}.
        </p>
      )}
      {shown.length > 0 && (
        <div className="tg-rows overflow-hidden rounded-2xl bg-card">
          {shown.map((p) => (
            <div key={p.personId} className={`flex flex-col gap-1.5 px-4 py-3 ${p.refusal ? "opacity-60" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col">
                  <span className="font-medium">
                    {p.rank} {p.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {p.campName} · {p.role || "no role on the roster"}
                  </span>
                </div>
                {!p.refusal && (
                  <button
                    type="button"
                    disabled={pending}
                    aria-busy={pending && sending === p.personId}
                    onClick={() => {
                      setSending(p.personId);
                      call(
                        () => deployMan(requestId, p.personId),
                        (r) => {
                          toast.success(`${p.rank} ${p.name} sent`);
                          setLeft(r.state === "FILLED" ? 0 : left - 1);
                          router.refresh();
                        },
                      );
                    }}
                    className="tg-press flex min-h-11 shrink-0 items-center gap-1 rounded-xl bg-primary px-3.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                  >
                    <Check className="size-4" aria-hidden /> Send
                  </button>
                )}
              </div>
              {p.refusal && (
                <p className="flex gap-1.5 text-xs text-muted-foreground">
                  <CircleSlash className="mt-px size-3.5 shrink-0" aria-hidden /> {p.refusal}
                </p>
              )}
              {!p.refusal && p.free && (
                <p className="flex gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
                  <Moon className="mt-px size-3.5 shrink-0" aria-hidden /> {p.manning}: costs it nothing
                </p>
              )}
              {!p.refusal && !p.free && p.manning && <p className={`text-xs tabular-nums ${p.short ? "font-medium text-destructive" : "text-muted-foreground"}`}>{p.manning}</p>}
              {!p.refusal &&
                p.away.map((a) => (
                  <p key={a} className="flex gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden /> Already down for {a}
                  </p>
                ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
