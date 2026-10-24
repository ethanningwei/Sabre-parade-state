import { redirect } from "next/navigation";
import { StructureEditor } from "@/components/tg/changeover/structure-editor";
import { BigLink, Header } from "@/components/tg/form-bits";
import { loadDraft } from "@/lib/wb/changeover-data";
import { requireFeaturePage } from "@/lib/flags";
import { requireChangeoverPage } from "@/lib/wb/changeover-page";

// The draft's platoons and sections, their SCs, PCs and PSes (mockup 2).
export default async function StructurePage() {
  await requireFeaturePage();
  await requireChangeoverPage();
  const d = await loadDraft();
  if (d.phase.phase !== "VIGILANCE") redirect("/tg/changeover");
  return (
    <div className="flex flex-col gap-6">
      <Header title="Platoons & sections" hint="Draft for ROT, in parade-state order. COY HQ stays as it is." />
      <StructureEditor
        hq={d.hq}
        platoons={d.platoons.map((p) => ({
          id: p.id,
          name: p.name,
          pc: p.pc,
          ps: p.ps,
          sections: p.sections.map((s) => ({ id: s.id, name: s.name, sc: s.sc, men: s.men.map((m) => ({ personId: m.personId, label: `${m.rank} ${m.name}` })) })),
        }))}
      />
      <BigLink href="/tg/changeover/sections">Assign men to sections</BigLink>
    </div>
  );
}
