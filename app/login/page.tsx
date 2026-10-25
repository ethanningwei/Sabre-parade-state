import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { buttonVariants } from "@/components/ui/button";
import { getViewer } from "@/lib/authz";
import { passwordSignInEnabled, signInBot } from "@/lib/session";
import { miniAppLink } from "@/lib/wb/telegram/links";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const viewer = await getViewer();
  if (viewer?.active && viewer.role !== "pending") redirect("/");

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-10 px-6 py-16">
      <div className="flex flex-col items-center gap-3 text-center">
        <Logo className="size-14" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sabre</h1>
          <p className="text-sm text-muted-foreground">Parade state · 8SIR</p>
        </div>
      </div>
      {passwordSignInEnabled() ? <LoginForm /> : <TelegramOnly bot={signInBot()} />}
    </main>
  );
}

// With APP_PASSWORD unset, the only way in is the Mini App's "Parade state".
function TelegramOnly({ bot }: { bot: string }) {
  return (
    <div className="flex w-full max-w-xs flex-col gap-4 text-center">
      <p className="text-base">
        Sabre opens from Telegram. Open <span className="font-medium">@{bot}</span>, then tap{" "}
        <span className="font-medium">Parade state</span>.
      </p>
      <a href={miniAppLink(bot)} className={buttonVariants({ size: "lg", className: "h-12 text-base" })}>
        Open @{bot}
      </a>
      <p className="text-xs text-muted-foreground">Not registered yet? Open the bot and tap Start.</p>
    </div>
  );
}
