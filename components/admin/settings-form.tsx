"use client";

import { Loader2, Send } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sendTestMessage, updateCoySettings } from "@/lib/actions/admin";

export function SettingsForm(props: {
  displayName: string;
  telegramChatId: string;
  telegramThreadId: string;
  tokenSet: boolean;
}) {
  const [displayName, setDisplayName] = useState(props.displayName);
  const [chatId, setChatId] = useState(props.telegramChatId);
  const [threadId, setThreadId] = useState(props.telegramThreadId);
  const [saving, startSave] = useTransition();
  const [testing, startTest] = useTransition();
  const dirty =
    displayName !== props.displayName || chatId !== props.telegramChatId || threadId !== props.telegramThreadId;

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-4 rounded-2xl bg-card p-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="dn">Display name</Label>
          <Input id="dn" value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="h-11" />
          <p className="text-xs text-muted-foreground">Printed as “{displayName || "…"} Parade State”.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="chat">Telegram chat ID</Label>
          <Input
            id="chat"
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
            inputMode="numeric"
            placeholder="-1001234567890"
            className="h-11 font-mono"
          />
          <p className="text-xs text-muted-foreground">Group IDs are negative. Use the same value as the old bot&apos;s SETTINGS tab.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="thread">Topic (thread) ID</Label>
          <Input
            id="thread"
            value={threadId}
            onChange={(e) => setThreadId(e.target.value)}
            inputMode="numeric"
            placeholder="Blank = main chat"
            className="h-11 font-mono"
          />
          <p className="text-xs text-muted-foreground">
            Only for groups with Topics. Open the topic in Telegram Web: the URL ends with this number.
          </p>
        </div>
        <Button
          disabled={!dirty || saving}
          onClick={() =>
            startSave(async () => {
              const res = await updateCoySettings({ displayName, telegramChatId: chatId, telegramThreadId: threadId });
              if (res.ok) toast.success("Saved");
              else toast.error(res.error);
            })
          }
        >
          {saving && <Loader2 className="animate-spin" />}
          Save
        </Button>
      </section>

      <section className="flex flex-col gap-3 rounded-2xl bg-card p-4">
        <p className="font-medium">Test the connection</p>
        {!props.tokenSet ? (
          <p className="text-sm text-muted-foreground">
            The bot token isn&apos;t set. Add <code className="font-mono">TELEGRAM_BOT_TOKEN</code> to the
            environment (the same token as the old bot).
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Sends a short test message to the chat/topic above (save first).</p>
        )}
        <Button
          variant="outline"
          disabled={!props.tokenSet || !props.telegramChatId || dirty || testing}
          onClick={() =>
            startTest(async () => {
              const res = await sendTestMessage();
              if (res.ok) toast.success("Test message sent. Check the chat.");
              else toast.error(res.error);
            })
          }
        >
          {testing ? <Loader2 className="animate-spin" /> : <Send />}
          Send test message
        </Button>
      </section>
    </div>
  );
}
