import { cn } from "@/lib/utils";

/**
 * A number that counts up from 0 when it first appears (.count-up in
 * globals.css; reduced motion shows it straight away). The digits are CSS
 * generated, so screen readers get a plain copy.
 */
export function CountUp({ value, className }: { value: number; className?: string }) {
  return (
    <>
      <span aria-hidden className={cn("count-up", className)} style={{ "--to": value } as React.CSSProperties} />
      <span className="sr-only">{value}</span>
    </>
  );
}
