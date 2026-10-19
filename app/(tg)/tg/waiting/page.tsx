import { Hourglass, PenLine } from "lucide-react";
import { redirect } from "next/navigation";
import { BigLink } from "@/components/tg/form-bits";
import { enter } from "@/components/tg/ui";
import { requireFeaturePage } from "@/lib/flags";
import { requireMember } from "@/lib/wb/auth";
import { isWaiting } from "@/lib/wb/domain/roster-flow";
import { place } from "@/lib/wb/format";
import { profileOf } from "@/lib/wb/members";

// Registered, but not on the parade state and holding no grant: every other
// screen sends him here (requireRegistered). Fix my details is the way out,
// or his PS adding him from Roster.
export default async function WaitingPage() {
  await requireFeaturePage();
  const member = await requireMember();
  if (!member.registeredAt) redirect("/tg/register");
  if (!isWaiting(member)) redirect("/tg");
  const me = await profileOf(member);

  return (
    <div className="flex flex-col gap-6 pt-6">
      <div className="tg-enter flex flex-col items-center gap-3 px-4 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-card text-muted-foreground [&_svg]:size-7">
          <Hourglass aria-hidden />
        </span>
        <h1 className="text-[1.625rem] leading-tight font-semibold tracking-tight text-balance">Waiting to be added to the parade state</h1>
        <p className="text-sm text-muted-foreground">Your PS can see you and will add you. You&apos;ll get a message from Sabre when it&apos;s done.</p>
      </div>

      <section className="tg-enter flex flex-col gap-1 rounded-2xl bg-card px-4 py-3.5" style={enter(1)}>
        <p className="text-[0.6875rem] font-semibold tracking-wider text-muted-foreground uppercase">You registered as</p>
        <p className="text-lg leading-snug font-semibold">
          {me.rank} {me.name}
        </p>
        <p className="text-sm text-muted-foreground">{place(me.campName, me.subunitName) || "No camp given"}</p>
      </section>

      <div className="tg-enter flex flex-col gap-2" style={enter(2)}>
        <BigLink href="/tg/register" outline>
          <PenLine aria-hidden /> Fix my details
        </BigLink>
        <p className="px-1 text-center text-xs text-muted-foreground">Wrong name, rank or camp? Fix it, or pick yourself from the parade state if you&apos;re already on it.</p>
      </div>
    </div>
  );
}
