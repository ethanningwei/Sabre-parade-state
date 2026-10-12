"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { removeCommanderChat } from "@/lib/wb/actions/admin";

type Chat = { id: string; subunitName: string; chatId: number; threadId: number | null; chatTitle: string; linkedAt: string };

export function ChatsEditor({ chats }: { chats: Chat[] }) {
  if (!chats.length) return <p className="text-sm text-muted-foreground">No chats linked yet.</p>;
  return (
    <div className="flex flex-col gap-2">
      {chats.map((c) => (
        <ChatCard key={c.id} c={c} />
      ))}
    </div>
  );
}

function ChatCard({ c }: { c: Chat }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border bg-card p-3">
      <div>
        <p className="font-medium">{c.subunitName}</p>
        <p className="text-xs text-muted-foreground">
          {c.chatTitle || "Untitled chat"}
          {c.threadId ? ` · topic ${c.threadId}` : ""} · <span className="font-mono">{c.chatId}</span>
        </p>
      </div>
      <Button
        size="sm"
        variant="destructive"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await removeCommanderChat(c.id);
            if (!res.ok) return void toast.error(res.error);
            toast.success("Removed");
            router.refresh();
          })
        }
      >
        {pending && <Loader2 className="animate-spin" />}
        Remove
      </Button>
    </div>
  );
}
