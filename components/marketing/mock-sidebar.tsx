"use client";

import {
  Bot,
  Box,
  ChevronDown,
  Inbox,
  RefreshCcw,
  Search,
  Target,
  UserRound,
} from "lucide-react";
import { ReactNode, useEffect, useRef, useState } from "react";
import { Kbd } from "@/components/marketing/kbd";
import { Logo } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

type Item = {
  key: string;
  label: string;
  icon: ReactNode;
  badge?: string;
  kbd?: string;
  /** Clicking a team makes it the selected one. */
  team?: boolean;
};

const MAIN: Item[] = [
  { key: "inbox", label: "Inbox", icon: <Inbox className="size-3.5" />, badge: "3" },
  { key: "mine", label: "My issues", icon: <UserRound className="size-3.5" /> },
  { key: "search", label: "Search", icon: <Search className="size-3.5" />, kbd: "/" },
];
const WORKSPACE: Item[] = [
  { key: "projects", label: "Projects", icon: <Target className="size-3.5" /> },
  { key: "cycles", label: "Cycles", icon: <RefreshCcw className="size-3.5" /> },
  { key: "ai", label: "AI Agent", icon: <Bot className="size-3.5" />, badge: "Pro" },
];
const TEAMS: Item[] = [
  { key: "eng", label: "Engineering", icon: <Box className="size-3.5" />, team: true },
  { key: "design", label: "Design", icon: <Box className="size-3.5" />, team: true },
  { key: "growth", label: "Growth", icon: <Box className="size-3.5" />, team: true },
];
const TOUR = [...MAIN, ...WORKSPACE, ...TEAMS];

const STEP_MS = 1300;
const CLICK_AT_MS = 750;

/**
 * Hero mock sidebar (brand: navy cursor and tag; green only for the click
 * and the selected team, the "action / done" color) with a live "teammate" cursor: it glides to each item in
 * turn, hovers it, clicks it, and a clicked team becomes the selected one.
 * Runs only while visible, and stays still with prefers-reduced-motion.
 */
export type MockPage = (typeof TOUR)[number]["key"];

export function MockSidebar({
  selected,
  onOpen,
}: {
  /** The page currently shown in the main area. */
  selected: string;
  /** Called when the cursor clicks an item: the main area switches page. */
  onOpen: (key: string) => void;
}) {
  const navRef = useRef<HTMLElement>(null);
  const itemRefs = useRef<Record<string, HTMLSpanElement | null>>({});
  const [step, setStep] = useState(-1);
  const [clicking, setClicking] = useState(false);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [running, setRunning] = useState(false);

  // Animate only when on screen and motion is allowed.
  useEffect(() => {
    const el = navRef.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const io = new IntersectionObserver(([entry]) => setRunning(entry.isIntersecting), {
      threshold: 0.4,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Advance one item per step.
  useEffect(() => {
    if (!running) return;
    // Show the cursor almost right away, then one item per step.
    const first = setTimeout(() => setStep((s) => (s < 0 ? 0 : s)), 250);
    const timer = setInterval(() => setStep((s) => (s + 1) % TOUR.length), STEP_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [running]);

  // Move the cursor to the current item, then "click" it.
  useEffect(() => {
    if (step < 0) return;
    const item = TOUR[step];
    const el = itemRefs.current[item.key];
    const nav = navRef.current;
    if (!el || !nav) return;
    const box = el.getBoundingClientRect();
    const base = nav.getBoundingClientRect();
    setCursor({ x: box.left - base.left + Math.min(110, box.width * 0.55), y: box.top - base.top + box.height / 2 });
    const down = setTimeout(() => {
      setClicking(true);
      onOpen(item.key);
    }, CLICK_AT_MS);
    const up = setTimeout(() => setClicking(false), CLICK_AT_MS + 220);
    return () => {
      clearTimeout(down);
      clearTimeout(up);
    };
  }, [step, onOpen]);

  const hovered = step >= 0 ? TOUR[step].key : null;

  const row = (item: Item) => {
    const isActive = item.key === selected;
    const isHover = hovered === item.key;
    return (
      <span
        key={item.key}
        ref={(el) => {
          itemRefs.current[item.key] = el;
        }}
        className={cn(
          "relative flex h-7 items-center gap-2 rounded-md px-2 transition-colors duration-200",
          isHover && !isActive && "bg-accent/70 text-foreground",
          isActive && "bg-accent font-medium text-foreground [&>svg]:text-brand"
        )}
      >
        {item.icon}
        {item.label}
        {item.badge ? (
          <span className="ml-auto rounded border px-1 text-[0.625rem]">
            {item.key === "inbox" && step >= 0 && TOUR.indexOf(item) < step ? "2" : item.badge}
          </span>
        ) : null}
        {item.kbd ? <Kbd className="ml-auto h-4">{item.kbd}</Kbd> : null}
        {isHover && clicking ? (
          <span className="pointer-events-none absolute inset-0 animate-[mock-click_420ms_ease-out] rounded-md ring-2 ring-primary/60" />
        ) : null}
      </span>
    );
  };

  return (
    <aside className="hidden w-52 shrink-0 flex-col border-r bg-muted/20 md:flex">
      <div className="flex h-10 items-center gap-2 border-b px-3">
        <Logo size={18} title="" />
        <span className="flex size-5 items-center justify-center rounded bg-[#1A3250] text-[0.625rem] font-bold text-white">
          A
        </span>
        <span className="text-xs font-semibold">Acme Inc</span>
        <ChevronDown className="size-3 text-muted-foreground" />
      </div>
      <nav ref={navRef} className="relative flex flex-col gap-0.5 p-2 text-xs text-muted-foreground">
        {MAIN.map(row)}
        <p className="mt-3 mb-1 px-2 text-[0.625rem] font-medium tracking-wider uppercase">
          Workspace
        </p>
        {WORKSPACE.map(row)}
        <p className="mt-3 mb-1 px-2 text-[0.625rem] font-medium tracking-wider uppercase">
          Teams
        </p>
        {TEAMS.map(row)}

        {/* Live teammate cursor */}
        {cursor ? (
          <span
            aria-hidden
            className="pointer-events-none absolute left-0 top-0 z-10 transition-transform duration-700 ease-[cubic-bezier(.22,.8,.3,1)]"
            style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)` }}
          >
            <svg
              width="16"
              height="18"
              viewBox="0 0 16 18"
              className={cn("drop-shadow transition-transform duration-150", clicking && "scale-90")}
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
      </nav>
    </aside>
  );
}
