import { StandDown } from "@/components/tg/rf/rf-actions";
import { AssignForm } from "@/components/tg/rf/assign-form";
import { Group } from "@/components/tg/ui";
import { requireFeaturePage } from "@/lib/flags";
import { requireScreenPage } from "@/lib/wb/auth";
import { todaySgt } from "@/lib/wb/domain/timeline";
import { campsInfo } from "@/lib/wb/forecast-data";
import { assignmentsInScope, peopleToSend } from "@/lib/wb/rf-data";

// Assign Extra, RF or SOL straight onto men in scope, and the ones on now or
// coming up, each with Stand down.
export default async function AssignPage() {
  await requireFeaturePage();
  const member = await requireScreenPage("rf");
  const [people, camps, current] = await Promise.all([peopleToSend(member.grants), campsInfo(), assignmentsInScope(member.grants)]);
  return (
    <div className="flex flex-col gap-8">
      <AssignForm people={people} camps={camps.filter((c) => !c.isHq).map((c) => ({ id: c.id, name: c.name, subunitName: c.subunitName }))} today={todaySgt()} />
      {current.length > 0 && (
        <Group title={`On now or coming up · ${current.length}`} rows>
          {current.map((a) => (
            <div key={a.id} className="flex flex-col gap-1 px-4 py-3">
              <p>
                <span className="font-medium">
                  {a.rank} {a.name}
                </span>{" "}
                <span className="text-sm text-muted-foreground">· {a.homeCampName}</span>
              </p>
              <p className="text-sm text-muted-foreground">
                {a.line}
                {a.note ? ` · ${a.note}` : ""}
                {a.rfRequestId ? " · from a request" : ""}
              </p>
              <StandDown assignmentId={a.id} name={`${a.rank} ${a.name}`} />
            </div>
          ))}
        </Group>
      )}
    </div>
  );
}
