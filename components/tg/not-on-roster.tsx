import { NOT_ON_ROSTER } from "@/lib/wb/domain/rules";

/** For a SELF member: every record needs a roster person, so the forms wait until they're added. */
export function NotOnRoster() {
  return (
    <section className="flex flex-col gap-2 rounded-2xl bg-card p-4">
      <p className="font-medium">You&apos;re not on the parade state yet</p>
      <p className="text-sm text-muted-foreground">{NOT_ON_ROSTER} They can see you on Gaps.</p>
    </section>
  );
}
