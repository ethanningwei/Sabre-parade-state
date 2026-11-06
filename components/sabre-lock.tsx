import { Lock } from "lucide-react";

// Projection on: Sabre owns the parade state, so these screens are read-only.
// Server-rendered.

export function SabreLock() {
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-muted/60 p-3 text-sm">
      <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <p className="flex-1">
        <span className="font-medium">The parade state follows Sabre.</span> Statuses, Extra/RF/SOL and HOTOs are updated in the Mini App, and
        men are marked back under Back? there, so none of it can be changed here.
      </p>
    </div>
  );
}
