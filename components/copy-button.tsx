"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // older iOS / non-secure contexts
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

export function CopyButton({
  text,
  label = "Copy",
  ...props
}: { text: string; label?: string } & Omit<React.ComponentProps<typeof Button>, "onClick">) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      {...props}
      onClick={async () => {
        if (await copyText(text)) {
          setCopied(true);
          toast.success("Copied. Paste it into Telegram.");
          setTimeout(() => setCopied(false), 2000);
        } else toast.error("Couldn't copy. Select the text and copy it manually.");
      }}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? "Copied" : label}
    </Button>
  );
}
