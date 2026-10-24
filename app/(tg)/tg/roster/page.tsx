import { Header } from "@/components/tg/form-bits";
import type { CampOption } from "@/components/tg/roster/person-fields";
import { RosterList, type ListCamp } from "@/components/tg/roster/roster-list";
import { WaitingRow } from "@/components/tg/roster/waiting-row";
import { Group } from "@/components/tg/ui";
import { requireFeaturePage } from "@/lib/flags";
import { rosterFor, sectionCommanders } from "@/lib/wb/admin-data";
import { ROLES_SECTION } from "@/lib/wb/domain/rot";
import { currentPhase } from "@/lib/wb/phase";
import { requireScreenPage } from "@/lib/wb/auth";
import { manAccess } from "@/lib/wb/domain/access";
import { similarName } from "@/lib/wb/domain/roster-flow";

// The roster in the viewer's scope (a GC his camp, a PS/PC his platoon,
// company command, ASAs and admins everyone): who's waiting to be added,
// + Add person, and every man, tap to edit. Removal goes through Person
// history. Ordering men, and camps and platoons, stay in v1's Admin.
export default async function RosterPage() {
  await requireFeaturePage();
  const member = await requireScreenPage("roster");
  // in ROT: by section, with its SC; the Vigilance camps the switch hid are left out (mockup 10)
  const phase = await currentPhase();
  const rot = phase.phase === "ROT";
  const [r, scs] = await Promise.all([rosterFor(member.grants, phase.hidden), rot ? sectionCommanders() : new Map<string, string>()]);
  const options: CampOption[] = r.camps.map((c) => ({ id: c.id, name: c.name, subunitName: c.subunitName, isHq: c.isHq, roles: rot && !c.isHq ? ROLES_SECTION : undefined }));
  const camps: ListCamp[] = r.camps.map((c) => {
    // by camp: the man's own sheet refuses yourself (removalRefusal)
    const can = manAccess({ grants: member.grants }, { subunitId: c.subunitId, campId: c.id });
    return { id: c.id, name: c.name, subunitName: c.subunitName, sc: scs.get(c.id), history: can.history, remove: can.removes, people: c.people };
  });
  const unregistered = r.camps.flatMap((c) => c.people.filter((p) => !p.registered).map((p) => ({ ...p, campId: c.id, campName: c.name })));

  return (
    <div className="flex flex-col gap-6">
      <Header title="Roster" hint={`${r.reach} · Changes go straight onto the parade state.`} />

      {r.waiting.length > 0 && (
        <Group title={`Waiting to be added · ${r.waiting.length}`} hint="Registered themselves. Add them to the parade state, or link them to who they already are on it.">
          <div className="tg-rows overflow-hidden rounded-2xl bg-card">
            {r.waiting.map((m) => (
              <WaitingRow
                key={m.id}
                memberId={m.id}
                label={m.label}
                sub={[m.where, m.tgUsername && `@${m.tgUsername}`].filter(Boolean).join(" · ")}
                self={m.self}
                campId={m.campId}
                camps={options}
                candidates={unregistered
                  .filter((p) => p.campId === m.campId && similarName(m.self.name ?? m.label, p.name))
                  .map((p) => ({ personId: p.personId, label: `${p.rank} ${p.name}`, campName: p.campName }))}
              />
            ))}
          </div>
        </Group>
      )}

      <RosterList camps={camps} options={options} selfId={member.personId} />

      {r.left.length > 0 && (
        <Group title={`Left the roster · ${r.left.length}`} hint="Their roster person is inactive. Deactivate them in Admin › Members, or re-link them.">
          <div className="tg-rows overflow-hidden rounded-2xl bg-card">
            {r.left.map((m) => (
              <div key={m.id} className="px-4 py-2.5">
                <p className="text-sm font-medium">{m.label}</p>
                {m.where && <p className="text-xs text-muted-foreground">{m.where}</p>}
              </div>
            ))}
          </div>
        </Group>
      )}
    </div>
  );
}
