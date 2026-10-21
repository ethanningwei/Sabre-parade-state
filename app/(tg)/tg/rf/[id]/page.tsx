import { notFound, redirect } from "next/navigation";
import { BigLink, Header } from "@/components/tg/form-bits";
import { CloseRequest, StandDown } from "@/components/tg/rf/rf-actions";
import { RfSummary } from "@/components/tg/rf/rf-summary";
import { Group } from "@/components/tg/ui";
import { requireFeaturePage } from "@/lib/flags";
import { requireRegistered } from "@/lib/wb/auth";
import { rfAccess } from "@/lib/wb/domain/access";
import { rfView } from "@/lib/wb/rf-data";

// One request (a card's Open): what it wants, who's been sent (each with
// Stand down for whoever may), Deploy someone and Close.
export default async function RfRequestPage({ params }: { params: Promise<{ id: string }> }) {
  await requireFeaturePage();
  const member = await requireRegistered();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const r = await rfView(id);
  if (!r) notFound();
  const now = new Date();
  const can = rfAccess(member, r, now);
  if (!can.open) redirect("/tg");

  return (
    <div className="flex flex-col gap-5">
      <Header title={`RF for ${r.campName}`} />
      <RfSummary r={r} now={now} />
      {can.deploy && <BigLink href={`/tg/rf/${r.id}/deploy`}>Deploy someone</BigLink>}
      {r.deployed.length > 0 && (
        <Group title="Sent" rows>
          {r.deployed.map((d) => (
            <div key={d.assignmentId} className="flex flex-col gap-1 px-4 py-3">
              <p>
                <span className="font-medium">
                  {d.rank} {d.name}
                </span>{" "}
                <span className="text-sm text-muted-foreground">· from {d.campName}</span>
              </p>
              {can.standDown(d) && <StandDown assignmentId={d.assignmentId} name={`${d.rank} ${d.name}`} />}
            </div>
          ))}
        </Group>
      )}
      {can.close && <CloseRequest requestId={r.id} sent={r.deployed.length} />}
      <BigLink href="/tg/rf" outline>
        RF board
      </BigLink>
    </div>
  );
}
