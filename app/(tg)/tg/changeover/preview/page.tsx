import { CircleAlert } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { BigLink, Header } from "@/components/tg/form-bits";
import { loadDraft, preview } from "@/lib/wb/changeover-data";
import { requireFeaturePage } from "@/lib/flags";
import { requireChangeoverPage } from "@/lib/wb/changeover-page";

// The ROT parade state as it would print right now, from the draft (mockup
// 6). Nothing is saved or sent.
export default async function PreviewPage() {
  await requireFeaturePage();
  await requireChangeoverPage();
  const d = await loadDraft();
  const p = preview(d);
  return (
    <div className="flex flex-col gap-4">
      <Header title="ROT parade state" hint="What it would print right now, from the draft. Nothing is sent. The format is provisional until a real ROT parade state arrives." />
      {p.unplaced > 0 && (
        <p className="flex gap-2 rounded-xl bg-amber-500/12 px-3 py-2.5 text-sm text-amber-700 dark:text-amber-300">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {p.unplaced} {p.unplaced === 1 ? "man has" : "men have"} no section yet and {p.unplaced === 1 ? "isn't" : "aren't"} counted below.
        </p>
      )}
      {p.issues.length > 0 && (
        <details className="rounded-xl bg-card px-3 py-2.5 text-sm">
          <summary className="cursor-pointer font-medium text-destructive">{p.issues.length} things would block it today</summary>
          <ul className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
            {p.issues.slice(0, 40).map((i, n) => (
              <li key={n}>
                {i.scope.join(" · ")}: {i.message}
              </li>
            ))}
          </ul>
        </details>
      )}
      <pre className="overflow-x-auto rounded-2xl bg-card px-4 py-3.5 font-mono text-[13px] leading-normal whitespace-pre-wrap">{p.text}</pre>
      <div className="grid grid-cols-2 gap-2">
        <BigLink href="/tg/changeover" outline>
          Back
        </BigLink>
        <CopyButton text={p.text} label="Copy text" size="lg" className="h-12 rounded-xl text-base" />
      </div>
    </div>
  );
}
