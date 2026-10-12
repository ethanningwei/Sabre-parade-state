"use client";

import { Camera, CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

// The photo of an MC or status paper. Shrunk on the phone to about 1600 px
// (still readable, well under Vercel's 4.5 MB body limit), then sent to
// /api/wb/photo, which puts it in the trooper's own chat with the bot and
// hands back a token for the form. Nothing is kept in the browser.

const MAX_SIDE = 1600;

async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't read that photo."))), "image/jpeg", 0.85));
}

type State = { kind: "empty" } | { kind: "uploading"; preview: string } | { kind: "done"; preview: string } | { kind: "error"; message: string };

export function PhotoPicker({ onToken, keepLabel }: { onToken: (token: string | null) => void; keepLabel?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ kind: "empty" });
  const shown = useRef<string | null>(null);
  const show = (blob: Blob) => {
    if (shown.current) URL.revokeObjectURL(shown.current);
    shown.current = URL.createObjectURL(blob);
    return shown.current;
  };
  useEffect(() => () => void (shown.current && URL.revokeObjectURL(shown.current)), []);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    onToken(null);
    try {
      const blob = await shrink(file);
      const preview = show(blob);
      setState({ kind: "uploading", preview });
      const fd = new FormData();
      fd.set("photo", new File([blob], "document.jpg", { type: "image/jpeg" }));
      const res = await fetch("/api/wb/photo", { method: "POST", body: fd });
      const body = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
      if (!res.ok || !body.token) throw new Error(body.error ?? "Couldn't save the photo. Try again.");
      setState({ kind: "done", preview });
      onToken(body.token);
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : "Couldn't save the photo. Try again." });
    } finally {
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <input ref={input} type="file" accept="image/*" className="hidden" aria-label="Photo of the document" onChange={(e) => pick(e.target.files?.[0])} />
      {"preview" in state && (
        // eslint-disable-next-line @next/next/no-img-element -- a local object URL, not an optimisable image
        <img src={state.preview} alt="The document you picked" className="max-h-64 w-full rounded-lg border object-contain" />
      )}
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={state.kind === "uploading"}
        className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-dashed bg-card px-3 font-medium active:bg-muted disabled:opacity-60"
      >
        {state.kind === "uploading" ? (
          <>
            <Loader2 className="size-4 animate-spin" /> Saving the photo…
          </>
        ) : state.kind === "done" ? (
          <>
            <CheckCircle2 className="size-4 text-emerald-600" /> Saved. Tap to use another
          </>
        ) : (
          <>
            <Camera className="size-4" /> {keepLabel && state.kind === "empty" ? "Use a new photo" : "Take or pick a photo"}
          </>
        )}
      </button>
      {keepLabel && state.kind === "empty" && <p className="text-xs text-muted-foreground">{keepLabel}</p>}
      {state.kind === "done" && <p className="text-xs text-muted-foreground">A copy is in your chat with the bot.</p>}
      {state.kind === "error" && (
        <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.message}
        </p>
      )}
    </div>
  );
}
