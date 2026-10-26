import Link from "next/link";
import { requireViewer } from "@/lib/authz";
import { currentCoy } from "@/lib/data/current";
import { BottomNav } from "@/components/bottom-nav";
import { UserMenu } from "@/components/user-menu";
import { Logo } from "@/components/logo";
import { PageTransition } from "@/components/page-transition";
import { BackToSabre } from "@/components/tg/back-to-sabre";
import { fromTelegram } from "@/lib/wb/from-telegram";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const [viewer, coyRow, fromTg] = await Promise.all([requireViewer(), currentCoy(), fromTelegram()]);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b bg-page/85 pt-[env(safe-area-inset-top)] backdrop-blur-md">
        {fromTg && <BackToSabre />}
        <div className="mx-auto flex h-14 w-full max-w-2xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2.5">
            <Logo className="size-8 rounded-lg" />
            <span className="font-semibold tracking-tight">{coyRow.displayName}</span>
          </Link>
          <UserMenu name={viewer.name} role={viewer.role} />
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pt-4 pb-[calc(6rem+env(safe-area-inset-bottom))]">
        <PageTransition>{children}</PageTransition>
      </main>
      <BottomNav isAdmin={viewer.role === "admin"} homeSubunitId={viewer.role === "guardcomm" ? viewer.subunitId : null} />
    </div>
  );
}
