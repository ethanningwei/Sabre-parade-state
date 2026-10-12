"use client";

import { Loader2, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { linkMember, searchRoster, setMemberActive, unlinkMember } from "@/lib/wb/actions/admin";
import type { MemberRow } from "@/lib/wb/admin-data";

type Hit = { personId: string; label: string; where: string; linked: boolean };

export function MembersEditor({ members, myId }: { members: MemberRow[]; myId: string }) {
  const [filter, setFilter] = useState("");
  const q = filter.trim().toUpperCase();
  const shown = q
    ? members.filter((m) => `${m.label} ${m.tgName} ${m.tgUsername ?? ""} ${m.where}`.toUpperCase().includes(q))
    : members;

  return (
    <div className="flex flex-col gap-3">
      <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter" className="h-11 text-base" />
      <p className="text-xs text-muted-foreground">{shown.length} of {members.length}</p>
      {shown.map((m) => (
        <MemberCard key={m.id} m={m} isMe={m.id === myId} />
      ))}
    </div>
  );
}

function MemberCard({ m, isMe }: { m: MemberRow; isMe: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [linking, setLinking] = useState(false);

  const act = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error);
      toast.success(done);
      setLinking(false);
      router.refresh();
    });

  return (
    <div className={`flex flex-col gap-2 rounded-xl border bg-card p-3 ${m.active ? "" : "opacity-60"}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium">{m.label}</p>
          <p className="text-xs text-muted-foreground">
            {[m.where, m.tgName, m.tgUsername && `@${m.tgUsername}`].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-1">
          {!m.registered && <Badge variant="outline">Not registered</Badge>}
          {m.registered && !m.personId && <Badge variant="secondary">Not on roster</Badge>}
          {m.personActive === false && <Badge variant="destructive">Left roster</Badge>}
          {!m.active && <Badge variant="outline">Inactive</Badge>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={pending} onClick={() => setLinking((v) => !v)}>
          {m.personId ? "Re-link" : "Link to roster"}
        </Button>
        {m.personId && (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => act(() => unlinkMember(m.id), "Unlinked")}>
            Unlink
          </Button>
        )}
        {!isMe && (
          <Button
            size="sm"
            variant={m.active ? "destructive" : "outline"}
            disabled={pending}
            onClick={() => act(() => setMemberActive(m.id, !m.active), m.active ? "Deactivated" : "Reactivated")}
          >
            {m.active ? "Deactivate" : "Reactivate"}
          </Button>
        )}
        {pending && <Loader2 className="size-4 animate-spin self-center" />}
      </div>
      {linking && <LinkSearch onPick={(personId) => act(() => linkMember(m.id, personId), "Linked")} />}
    </div>
  );
}

function LinkSearch({ onPick }: { onPick: (personId: string) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="flex flex-col gap-2 border-t pt-2">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await searchRoster(q);
            if (!res.ok) return void toast.error(res.error);
            setHits(res.data);
          });
        }}
      >
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Roster name" autoCapitalize="characters" className="h-10 text-base" />
        <Button type="submit" size="icon-lg" variant="outline" disabled={pending || q.trim().length < 2} aria-label="Search">
          {pending ? <Loader2 className="animate-spin" /> : <Search />}
        </Button>
      </form>
      {hits?.length === 0 && <p className="text-sm text-muted-foreground">Nobody on the roster matches.</p>}
      {hits?.map((h) => (
        <button
          key={h.personId}
          type="button"
          disabled={h.linked}
          onClick={() => onPick(h.personId)}
          className="flex flex-col items-start rounded-lg border px-3 py-2 text-left disabled:opacity-50"
        >
          <span className="text-sm font-medium">{h.label}</span>
          <span className="text-xs text-muted-foreground">
            {h.where}
            {h.linked && " · already linked"}
          </span>
        </button>
      ))}
    </div>
  );
}
