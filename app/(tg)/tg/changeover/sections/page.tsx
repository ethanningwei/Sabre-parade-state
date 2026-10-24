import { Rows3 } from "lucide-react";
import { redirect } from "next/navigation";
import { SectionsEditor } from "@/components/tg/changeover/sections-editor";
import { BigLink, Header } from "@/components/tg/form-bits";
import { EmptyState } from "@/components/tg/ui";
import { checklist, loadDraft } from "@/lib/wb/changeover-data";
import { requireFeaturePage } from "@/lib/flags";
import { requireChangeoverPage } from "@/lib/wb/changeover-page";

// Assign men to sections (mockup 3). ?section= is the one being filled.
export default async function SectionsPage({ searchParams }: { searchParams: Promise<{ section?: string | string[] }> }) {
  await requireFeaturePage();
  await requireChangeoverPage();
  const d = await loadDraft();
  if (d.phase.phase !== "VIGILANCE") redirect("/tg/changeover");
  const sp = await searchParams;
  const sections = d.platoons.flatMap((p) => p.sections);
  const want = typeof sp.section === "string" ? sp.section : null;
  const sectionId = sections.find((s) => s.id === want)?.id ?? sections[0]?.id;
  const c = checklist(d);

  return (
    <div className="flex flex-col gap-5">
      <Header title="Sections" hint="Anyone in COY HQ can do this." />
      {!sectionId ? (
        <EmptyState icon={<Rows3 />} title="No sections yet">
          <p>Draft the platoons and their sections first, or paste the Telegram list: it drafts the sections it names.</p>
          <BigLink href="/tg/changeover/structure">Platoons & sections</BigLink>
          <BigLink href="/tg/changeover/paste" outline>
            Paste a list
          </BigLink>
        </EmptyState>
      ) : (
        <SectionsEditor
          platoons={d.platoons.map((p) => ({ id: p.id, name: p.name, sections: p.sections.map((s) => ({ id: s.id, name: s.name, count: s.men.length })) }))}
          sectionId={sectionId}
          men={d.men.filter((m) => !m.svc).map((m) => ({ personId: m.personId, label: `${m.rank} ${m.name}`, role: m.role, campId: m.campId, campName: m.campName, sectionId: m.sectionId }))}
          placed={c.placed}
          total={c.toPlace}
        />
      )}
    </div>
  );
}
