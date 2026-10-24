import { Header } from "@/components/tg/form-bits";
import { Group } from "@/components/tg/ui";
import { requireFeaturePage } from "@/lib/flags";
import { loadDraft } from "@/lib/wb/changeover-data";
import { requireChangeoverPage } from "@/lib/wb/changeover-page";

// The SVC troopers still on the roster (mockup 8's list). Switch to ROT takes
// them all off, one at a time as ORD does; Switch back brings them back.
export default async function SvcPage() {
  await requireFeaturePage();
  await requireChangeoverPage();
  const d = await loadDraft();
  const svc = d.men.filter((m) => m.svc);
  const byCamp = [...new Set(svc.map((m) => m.campName))].map((camp) => ({ camp, men: svc.filter((m) => m.campName === camp) }));
  return (
    <div className="flex flex-col gap-6">
      <Header
        title="SVC troopers leaving"
        hint={`${svc.length} still on the roster. Switch to ROT takes each off as ORD does: off the parade state, his Sabre account switched off, requests waiting on a decision withdrawn. His records stay as history, and Switch back brings him back.`}
      />
      {byCamp.map((g) => (
        <Group key={g.camp} title={`${g.camp} · ${g.men.length}`} rows>
          {g.men.map((m) => (
            <p key={m.personId} className="px-4 py-2.5 text-sm font-medium">
              {m.rank} {m.name}
            </p>
          ))}
        </Group>
      ))}
    </div>
  );
}
