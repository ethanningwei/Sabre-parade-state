import { notFound, redirect } from "next/navigation";
import { BigLink, DoneScreen, Header } from "@/components/tg/form-bits";
import { DeployList } from "@/components/tg/rf/deploy-list";
import { RfSummary } from "@/components/tg/rf/rf-summary";
import { requireFeaturePage } from "@/lib/flags";
import { requireRegistered } from "@/lib/wb/auth";
import { isOver, rfAnything, shortBy, wants } from "@/lib/wb/domain/rf";
import { candidatesFor, rfView } from "@/lib/wb/rf-data";

// Deploy someone (the card's 📌 button): the men this commander may send,
// best first, each with what losing him does to his own camp and anything
// he's already down for.
export default async function DeployPage({ params }: { params: Promise<{ id: string }> }) {
  await requireFeaturePage();
  const member = await requireRegistered();
  if (!rfAnything(member.grants)) redirect("/tg");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const r = await rfView(id);
  if (!r) notFound();
  const now = new Date();

  if (r.state !== "OPEN" || isOver(r, now)) {
    return (
      <DoneScreen title={r.state === "FILLED" ? "Already filled" : r.state === "CLOSED" ? "Closed" : r.state === "EXPIRED" ? "Expired" : "Over"} tone="warn" line={`${r.campName} isn't asking for anyone now.`}>
        <BigLink href={`/tg/rf/${r.id}`}>Open the request</BigLink>
        <BigLink href="/tg/rf" outline>
          RF board
        </BigLink>
      </DoneScreen>
    );
  }
  const people = await candidatesFor(r, member.grants, now);
  return (
    <div className="flex flex-col gap-5">
      <Header title="Deploy someone" hint={`${r.campName} wants ${wants(r)}. Pick from your men: the best to send are at the top.`} />
      <RfSummary r={r} now={now} />
      <DeployList
        requestId={r.id}
        want={r.role}
        wantLabel={r.role === "ANY" ? "Any role" : r.role}
        short={shortBy(r)}
        people={people.map((p) => ({ personId: p.personId, rank: p.rank, name: p.name, campName: p.campName, role: p.role, away: p.away, refusal: p.refusal, manning: p.manning, short: p.short, free: p.free }))}
      />
    </div>
  );
}
