"use client";

import { RefreshCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CYCLE_BARS } from "@/components/marketing/mock-data";
import { useMockDoneExtra } from "@/components/marketing/mock-progress";
import { cn } from "@/lib/utils";

/**
 * Compact cycle progress card: header, progress bar, scope stats and a small
 * burnup chart. It is live: bars rise when it scrolls into view, and every
 * card the board mock drops into Done ticks Completed up, fills the progress
 * bar and grows today's bar.
 */
export function MockCycle({ className }: { className?: string }) {
  const scope = 38;
  const extra = useMockDoneExtra();
  const completed = CYCLE_BARS[CYCLE_BARS.length - 1] + extra;
  const percent = Math.round((completed / scope) * 100);
  const bars = [...CYCLE_BARS.slice(0, -1), completed];
  const max = Math.max(...CYCLE_BARS) + 2;

  // Grow the bars from zero the first time the card is seen.
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.4 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={cn("rounded-xl border bg-card p-4 shadow-sm", className)}>
      <div className="flex items-center gap-2">
        <RefreshCcw
          className={cn(
            "size-3.5 text-muted-foreground",
            shown && "animate-[spin_1.2s_ease-out_1] motion-reduce:animate-none"
          )}
        />
        <span className="text-sm font-medium">Cycle 14</span>
        <span className="text-xs text-muted-foreground">Jun 2 to Jun 16</span>
        <span
          key={percent}
          className="ml-auto animate-in font-mono text-xs text-success zoom-in-75 duration-300"
        >
          {percent}%
        </span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-status-done transition-[width] duration-700 ease-out motion-reduce:transition-none"
          style={{ width: `${shown ? percent : 0}%` }}
        />
      </div>
      <div className="mt-3 flex items-center gap-4 text-[0.6875rem] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-foreground/30" />
          Scope {scope}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-status-in-progress" />
          Started {Math.max(0, 7 - extra)}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-status-done" />
          Completed{" "}
          <span key={completed} className="animate-in font-medium text-foreground zoom-in-75 duration-300">
            {completed}
          </span>
        </span>
      </div>
      <div className="mt-4 flex h-12 items-end gap-1" aria-hidden>
        {bars.map((value, index) => (
          <div
            key={index}
            className={cn(
              "flex-1 rounded-sm transition-[height] duration-700 ease-out motion-reduce:transition-none",
              index === bars.length - 1 ? "bg-status-done" : "bg-foreground/10"
            )}
            style={{
              height: shown ? `${Math.max(8, (value / max) * 100)}%` : "8%",
              transitionDelay: shown ? `${index * 35}ms` : undefined,
            }}
          />
        ))}
      </div>
      <p className="mt-2 text-[0.625rem] text-muted-foreground">
        Unfinished issues roll into Cycle 15 automatically.
      </p>
    </div>
  );
}
