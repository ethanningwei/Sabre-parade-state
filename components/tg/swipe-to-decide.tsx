"use client";

import { cn } from "cn";
import { Check, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { decideRecord, undoDecision } from "@/lib/wb/actions/records";
import { useAction } from "./form-bits";
import { tick } from "./webapp";

// How far a card must travel before letting go decides it, and how far it has
// to move sideways before it counts as a swipe rather than a scroll or a tap.
const DECIDE_AT = 0.32;
const START_AT = 10;

/**
 * Inbox's shortcut: swipe a request right to approve or left to reject (no
 * reason; "Say why" stays on the record), with Undo in the toast. The
 * Approve/Reject buttons inside the card are unchanged; this only adds a way.
 */
export function SwipeToDecide({ recordId, label, children }: { recordId: string; label: string; children: React.ReactNode }) {
  const router = useRouter();
  const { pending, error, call } = useAction();
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; id: number; on: boolean; past: boolean; dx: number } | null>(null);
  const swiped = useRef(false);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  // where the card flew off to once decided; back at 0 if the server refused
  const [off, setOff] = useState(0);

  const width = () => box.current?.offsetWidth ?? 320;

  const decide = (dir: 1 | -1) => {
    setOff(dir * (width() + 24));
    const action = dir === 1 ? "approve" : "reject";
    call(
      () => decideRecord({ recordId, action }),
      () => {
        toast.success(`${dir === 1 ? "Approved" : "Rejected"} ${label}`, {
          action: {
            label: "Undo",
            onClick: async () => {
              setOff(0);
              const res = await undoDecision({ recordId });
              if (res.ok) router.refresh();
              else toast.error(res.error);
            },
          },
        });
        router.refresh();
      },
    );
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (pending || (off && !error) || e.button !== 0) return;
    // the buttons and the reason box inside the card keep their taps
    if ((e.target as Element).closest("button, textarea, input")) return;
    drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId, on: false, past: false, dx: 0 };
    swiped.current = false;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const moveX = e.clientX - d.x;
    if (!d.on) {
      if (Math.abs(e.clientY - d.y) > START_AT) return void (drag.current = null); // a scroll
      if (Math.abs(moveX) < START_AT) return;
      d.on = true;
      swiped.current = true;
      setDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    const past = Math.abs(moveX) > width() * DECIDE_AT;
    if (past !== d.past) {
      d.past = past;
      tick(); // crossing the line, either way
    }
    d.dx = moveX;
    setDx(moveX);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (!d || d.id !== e.pointerId || !d.on) return;
    if (d.past) decide(d.dx > 0 ? 1 : -1);
    setDx(0);
  };

  // a swipe that ends over the card's link mustn't also open the record
  const onClickCapture = (e: React.MouseEvent) => {
    if (!swiped.current) return;
    swiped.current = false;
    e.preventDefault();
    e.stopPropagation();
  };

  const shift = off && !error ? off : dx;
  const side = shift > 0 ? 1 : shift < 0 ? -1 : 0;

  return (
    <div className="flex flex-col gap-2">
      <div ref={box} className="relative overflow-hidden rounded-2xl">
        <div
          aria-hidden
          className={cn(
            "absolute inset-0 flex items-center px-6 font-semibold text-white",
            side >= 0 ? "justify-start bg-present" : "justify-end bg-destructive",
            side === 0 && "invisible",
          )}
        >
          {side >= 0 ? (
            <span className="flex items-center gap-2">
              <Check className="size-5" strokeWidth={2.75} /> Approve
            </span>
          ) : (
            <span className="flex items-center gap-2">
              Reject <X className="size-5" strokeWidth={2.75} />
            </span>
          )}
        </div>
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            drag.current = null;
            setDragging(false);
            setDx(0);
          }}
          onClickCapture={onClickCapture}
          // a pressed link would start the browser's own drag and cancel the swipe
          onDragStart={(e) => e.preventDefault()}
          className={cn("relative touch-pan-y select-none", !dragging && "transition-transform duration-200 ease-out")}
          style={{ transform: `translateX(${shift}px)` }}
        >
          {children}
        </div>
      </div>
      {error && (
        <p role="alert" className="px-1 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
