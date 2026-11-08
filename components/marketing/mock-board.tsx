"use client";

import { useEffect, useRef, useState } from "react";
import { PriorityIcon } from "@/components/shared/priority-icon";
import { StatusIcon } from "@/components/shared/status-icon";
import { UserAvatar } from "@/components/shared/user-avatar";
import { BOARD_COLUMNS, type MockIssue } from "@/components/marketing/mock-data";
import { setMockDoneExtra } from "@/components/marketing/mock-progress";
import { MockFrame, MockWindowBar } from "@/components/marketing/mock-window";
import { cn } from "@/lib/utils";

type Columns = MockIssue[][];

/** Each move: the "Ada" cursor drags a card one column to the right. */
const MOVES: { id: string; to: number }[] = [
  { id: "ENG-138", to: 3 }, // In Review -> Done
  { id: "ENG-142", to: 2 }, // In Progress -> In Review
  { id: "ENG-147", to: 1 }, // Todo -> In Progress
  { id: "ENG-139", to: 2 }, // In Progress -> In Review
];
const DONE_COLUMN = 3;

const initialColumns = (): Columns => BOARD_COLUMNS.map((c) => [...c.issues]);

type Point = { x: number; y: number };
type Drag = { issue: MockIssue; from: Point; to: Point; size: { w: number; h: number }; moving: boolean };

/**
 * Kanban board mock for the Board & Cycles section. A live "teammate"
 * cursor picks up a card, drags it to the next column and drops it; counts
 * update and cards reaching Done feed the cycle card (mock-progress.ts).
 * Runs only while visible on wide screens; still with reduced motion.
 */
export function MockBoard({ className }: { className?: string }) {
  const [columns, setColumns] = useState<Columns>(initialColumns);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [pressed, setPressed] = useState(false);
  const [landed, setLanded] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const slotRefs = useRef<(HTMLDivElement | null)[]>([]);
  const columnsRef = useRef(columns);
  useEffect(() => {
    columnsRef.current = columns;
    // Tell the cycle card how many extra cards are now in Done.
    const extra = columns[DONE_COLUMN].length - BOARD_COLUMNS[DONE_COLUMN].issues.length;
    setMockDoneExtra(Math.max(0, extra));
  }, [columns]);

  // Only animate when on screen, wide enough for all 4 columns, motion allowed.
  useEffect(() => {
    const el = boardRef.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const wide = window.matchMedia("(min-width: 1024px)");
    const io = new IntersectionObserver(
      ([entry]) => setRunning(entry.isIntersecting && wide.matches),
      { threshold: 0.35 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const after = (ms: number, fn: () => void) =>
      new Promise<void>((resolve) =>
        timers.push(
          setTimeout(() => {
            if (!cancelled) fn();
            resolve();
          }, ms)
        )
      );

    const rel = (el: Element): DOMRect & { rx: number; ry: number } => {
      const r = el.getBoundingClientRect();
      const base = boardRef.current!.getBoundingClientRect();
      return Object.assign(r, { rx: r.left - base.left, ry: r.top - base.top });
    };

    const run = async () => {
      await after(400, () => {});
      for (let i = 0; !cancelled; i = (i + 1) % (MOVES.length + 1)) {
        if (i === MOVES.length) {
          // End of loop: settle, then reset the board and the cycle card.
          await after(1600, () => {
            setColumns(initialColumns());
            setLanded(null);
          });
          await after(900, () => {});
          continue;
        }
        const move = MOVES[i];
        const cols = columnsRef.current;
        const fromCol = cols.findIndex((c) => c.some((x) => x.id === move.id));
        const issue = cols[fromCol]?.[cols[fromCol].findIndex((x) => x.id === move.id)];
        const card = cardRefs.current[move.id];
        const slot = slotRefs.current[move.to];
        if (!issue || !card || !slot || fromCol < 0) continue;

        // 1. Cursor travels to the card.
        const c = rel(card);
        setCursor({ x: c.rx + c.width * 0.6, y: c.ry + c.height * 0.45 });
        await after(750, () => setPressed(true));

        // 2. Pick it up: a lifted copy follows the cursor; the slot stays dashed.
        const s = rel(slot);
        const to = { x: s.rx, y: s.ry };
        setDrag({ issue, from: { x: c.rx, y: c.ry }, to, size: { w: c.width, h: c.height }, moving: false });
        await after(60, () => {
          setDrag((d) => (d ? { ...d, moving: true } : d));
          setCursor({ x: to.x + c.width * 0.6, y: to.y + c.height * 0.45 });
        });

        // 3. Drop into the target column.
        await after(950, () => {
          setPressed(false);
          setDrag(null);
          setColumns((prev) => {
            const next = prev.map((col) => col.filter((x) => x.id !== move.id));
            next[move.to] = [...next[move.to], { ...issue, status: BOARD_COLUMNS[move.to].status }];
            return next;
          });
          setLanded(move.id);
        });
        await after(1100, () => setLanded(null));
      }
    };
    void run();
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      setPressed(false);
      setDrag(null);
    };
  }, [running]);

  return (
    <MockFrame className={className}>
      <MockWindowBar title="Engineering · Board" />
      <div ref={boardRef} className="relative grid grid-cols-2 gap-3 bg-muted/20 p-3 lg:grid-cols-4">
        {BOARD_COLUMNS.map((column, columnIndex) => (
          <div
            key={column.label}
            className={cn("space-y-2", columnIndex >= 2 && "hidden lg:block")}
          >
            <div className="flex items-center gap-1.5 px-1">
              <StatusIcon status={column.status} className="size-3.5" />
              <span className="text-xs font-medium">{column.label}</span>
              <span
                key={columns[columnIndex].length}
                className="animate-in text-[0.6875rem] text-muted-foreground zoom-in-50 duration-300"
              >
                {columns[columnIndex].length}
              </span>
            </div>
            {columns[columnIndex].map((issue) => (
              <div
                key={issue.id}
                ref={(el) => {
                  cardRefs.current[issue.id] = el;
                }}
              >
                {drag?.issue.id === issue.id ? (
                  // Placeholder where the card was lifted from.
                  <div
                    className="rounded-lg border border-dashed border-primary/50 bg-primary/5"
                    style={{ height: drag.size.h }}
                  />
                ) : (
                  <MockBoardCard
                    issue={issue}
                    highlight={landed === issue.id}
                    className={landed === issue.id ? "animate-in zoom-in-95 fade-in-0 duration-300" : undefined}
                  />
                )}
              </div>
            ))}
            <div
              ref={(el) => {
                slotRefs.current[columnIndex] = el;
              }}
              className="flex h-7 items-center justify-center rounded-lg border border-dashed text-[0.6875rem] text-muted-foreground/60"
            >
              + Add issue
            </div>
          </div>
        ))}

        {/* The card being dragged, lifted and tilted, gliding to its column. */}
        {drag ? (
          <div
            aria-hidden
            className="pointer-events-none absolute left-0 top-0 z-10 transition-transform duration-[900ms] ease-[cubic-bezier(.3,.7,.2,1)]"
            style={{
              width: drag.size.w,
              transform: `translate(${(drag.moving ? drag.to : drag.from).x}px, ${(drag.moving ? drag.to : drag.from).y}px)`,
            }}
          >
            <MockBoardCard issue={drag.issue} dragging />
          </div>
        ) : null}

        {/* Live teammate cursor */}
        {cursor ? (
          <span
            aria-hidden
            className="pointer-events-none absolute left-0 top-0 z-20 transition-transform duration-[900ms] ease-[cubic-bezier(.3,.7,.2,1)]"
            style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)` }}
          >
            <svg
              width="16"
              height="18"
              viewBox="0 0 16 18"
              className={cn("drop-shadow transition-transform duration-150", pressed && "scale-90")}
            >
              <path
                d="M1 1l13 7.2-5.6 1.5L5.6 16 1 1z"
                fill="var(--logo)"
                stroke="var(--background)"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
            </svg>
            <span
              className="ml-3 -mt-1 block w-fit rounded-full px-1.5 py-px text-[0.5625rem] font-semibold whitespace-nowrap"
              style={{ background: "var(--logo)", color: "var(--background)" }}
            >
              Ada
            </span>
          </span>
        ) : null}
      </div>
    </MockFrame>
  );
}

function MockBoardCard({
  issue,
  dragging,
  highlight,
  className,
}: {
  issue: MockIssue;
  dragging?: boolean;
  highlight?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "space-y-2 rounded-lg border bg-card p-2.5 transition-colors",
        dragging && "-rotate-2 border-ring shadow-lg shadow-black/20",
        highlight && "border-primary/60",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[0.625rem] text-muted-foreground">{issue.id}</span>
        {issue.assignee ? <UserAvatar name={issue.assignee} className="size-4" /> : null}
      </div>
      <p className="line-clamp-2 text-xs leading-snug font-medium">{issue.title}</p>
      <div className="flex items-center gap-1.5">
        <PriorityIcon priority={issue.priority} className="size-3" />
        {issue.label ? (
          <span className="size-2 rounded-full" style={{ backgroundColor: issue.label.color }} />
        ) : null}
        <span className="text-[0.625rem] text-muted-foreground">Cycle 14</span>
      </div>
    </div>
  );
}
