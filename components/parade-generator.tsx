"use client";

import { AlertTriangle, ChevronRight, Loader2, RefreshCw, Send } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "@/lib/toast";
import { buzzSuccess } from "@/components/tg/webapp";
import { CopyButton } from "@/components/copy-button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { generateParadeState, sendParadeState } from "@/lib/actions/parade";
import { formatSgt } from "@/lib/format";
import { ddmmyy } from "@/lib/parade/time";
import type { Issue, IssueTarget } from "@/lib/parade/types";

interface Sent {
  caaDate: string;
  caaTime: string;
  sentAt: string;
  by: string | null;
}

function fixHref(t: IssueTarget): string {
  switch (t.kind) {
    case "person":
      return `/c/${t.campId}?person=${t.personId}`;
    case "camp":
      return `/c/${t.campId}`;
    case "subunit":
      return `/admin/structure`;
    case "duty":
      return `/duties?duty=${t.dutyId}`;
  }
}

export function ParadeGenerator({
  defaultCaa,
  initialIssues,
  isAdmin,
  telegramReady,
  recentSends,
}: {
  defaultCaa: { date: string; time: string };
  initialIssues: Issue[];
  isAdmin: boolean;
  telegramReady: boolean;
  recentSends: Sent[];
}) {
  const [date, setDate] = useState(defaultCaa.date);
  const [time, setTime] = useState(`${defaultCaa.time.slice(0, 2)}:${defaultCaa.time.slice(2)}`);
  const [issues, setIssues] = useState<Issue[]>(initialIssues);
  const [result, setResult] = useState<{ id: string; text: string; caa: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [generating, startGenerate] = useTransition();
  const [sending, startSend] = useTransition();

  const caa = { date, time: time.replace(":", "") };
  const alreadySent = recentSends.find((s) => s.caaDate === caa.date && s.caaTime === caa.time);

  function generate() {
    startGenerate(async () => {
      const res = await generateParadeState(caa);
      if (!res.ok) return void toast.error(res.error);
      if ("id" in res.data) {
        setIssues([]);
        buzzSuccess();
        setResult({ id: res.data.id, text: res.data.text, caa: `${ddmmyy(caa.date)} ${caa.time}H` });
      } else {
        setIssues(res.data.issues);
        setResult(null);
        toast.error(`${res.data.issues.length} issue(s) to fix first`);
      }
    });
  }

  function send() {
    if (!result) return;
    startSend(async () => {
      const res = await sendParadeState(result.id);
      setConfirming(false);
      if (res.ok) toast.success(`Sent to Telegram${res.data.parts > 1 ? ` in ${res.data.parts} parts` : ""}`);
      else toast.error(res.error);
    });
  }

  // group issues by where they are
  const groups: { scope: string; items: Issue[] }[] = [];
  for (const i of issues) {
    const scope = i.scope.join(" › ");
    const g = groups.find((x) => x.scope === scope);
    if (g) g.items.push(i);
    else groups.push({ scope, items: [i] });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="px-1">
        <h1 className="text-xl font-semibold tracking-tight">Parade State</h1>
        <p className="text-sm text-muted-foreground">Checks everything first. Only a clean state can be generated.</p>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,7.5rem)] items-end gap-3 rounded-2xl bg-card p-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">CAA date</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11" />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Time</Label>
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-11" />
        </div>
      </div>

      <Button size="lg" className="h-12 text-base" onClick={generate} disabled={generating || !date || !time}>
        {generating ? <Loader2 className="animate-spin" /> : result ? <RefreshCw /> : null}
        {result ? "Regenerate" : "Generate parade state"}
      </Button>

      {issues.length > 0 && (
        <section className="flex flex-col gap-3 rounded-2xl border border-issue/30 bg-issue/5 p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-issue" />
            <div>
              <p className="font-medium">
                {issues.length} issue{issues.length > 1 ? "s" : ""}: parade state NOT generated
              </p>
              <p className="text-sm text-muted-foreground">Tap each one to fix it, then generate again.</p>
            </div>
          </div>
          {groups.map((g) => (
            <div key={g.scope} className="flex flex-col gap-1">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{g.scope}</p>
              <ul className="flex flex-col divide-y overflow-hidden rounded-xl bg-card">
                {g.items.map((i, n) => (
                  <li key={n}>
                    <Link
                      href={fixHref(i.target)}
                      className="flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-muted"
                    >
                      <span className="flex-1">{i.message}</span>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      {result && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <CopyButton text={result.text} size="lg" className="h-11 flex-1" />
            {isAdmin && (
              <Button
                size="lg"
                variant="secondary"
                className="h-11 flex-1"
                disabled={!telegramReady || sending}
                onClick={() => setConfirming(true)}
              >
                <Send /> Send to Telegram
              </Button>
            )}
          </div>
          {isAdmin && !telegramReady && (
            <p className="text-xs text-muted-foreground">
              Telegram isn&apos;t set up yet. Add the chat ID in{" "}
              <Link href="/admin/settings" className="text-primary underline">
                Admin › Coy settings
              </Link>
              .
            </p>
          )}
          <pre className="overflow-x-auto rounded-2xl bg-card p-4 font-sans text-[14px] leading-relaxed whitespace-pre-wrap">
            {result.text}
          </pre>
        </section>
      )}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send to Telegram?</AlertDialogTitle>
            <AlertDialogDescription>
              Posts the parade state for CAA {result?.caa} to the coy chat.
              {alreadySent && (
                <span className="mt-2 block font-medium text-issue">
                  One for this CAA was already sent {formatSgt(new Date(alreadySent.sentAt))}
                  {alreadySent.by ? ` by ${alreadySent.by}` : ""}.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={send} disabled={sending}>
              {sending && <Loader2 className="animate-spin" />}
              Send
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
