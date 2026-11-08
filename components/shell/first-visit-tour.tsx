"use client";

import { useUser } from "@clerk/nextjs";
import { X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type Step = { target?: string; title: string; body: string };

const STEPS: Step[] = [
  {
    title: "Welcome to DevTrack",
    body: "Take a quick look around: it takes about 30 seconds. You can skip at any time.",
  },
  {
    target: "workspace-switcher",
    title: "Your workspace",
    body: "Everything lives in a workspace. Switch between workspaces or create a new one here.",
  },
  {
    target: "new-issue",
    title: "Create issues",
    body: "Add a new issue from anywhere. Shortcut: press C.",
  },
  {
    target: "search",
    title: "Search everything",
    body: "Find issues, projects and commands fast. Shortcut: Ctrl + K.",
  },
  {
    target: "teams",
    title: "Teams",
    body: "Each team has its own issues and board. Create your first team with the + button.",
  },
  {
    target: "workspace-nav",
    title: "Projects, cycles and templates",
    body: "Group work into projects, plan sprints with cycles, and start fast from templates.",
  },
  {
    target: "ai-button",
    title: "Your AI agent",
    body: "Type, dictate or start a voice call. It creates, edits and finds things for you and opens pages on your screen. Shortcut: Ctrl + J.",
  },
  {
    target: "sidebar-toggle",
    title: "Make room",
    body: "Collapse the sidebar to icons whenever you want more space. Shortcut: Ctrl + \\.",
  },
];

const CARD_W = 320;
const GAP = 12;

function storageKey(userId: string) {
  return `devtrack:tour-done:${userId}`;
}

/**
 * First-visit product tour: a welcome card with Explore / Skip, then one
 * highlighted part of the screen per step with Next / Back / Skip. Shown
 * once per user per browser; finishing or skipping stores that.
 */
export function FirstVisitTour() {
  const { user } = useUser();
  const [step, setStep] = useState<number | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!user) return;
    let done = true;
    try {
      done = localStorage.getItem(storageKey(user.id)) === "1";
    } catch {
      // Storage blocked: don't nag on every visit.
    }
    if (done) return;
    // Let the workspace render before starting.
    const timer = setTimeout(() => setStep(0), 600);
    return () => clearTimeout(timer);
  }, [user]);

  const finish = useCallback(() => {
    setStep(null);
    if (!user) return;
    try {
      localStorage.setItem(storageKey(user.id), "1");
    } catch {
      // Not saved; the tour may show again next visit.
    }
  }, [user]);

  // Find the current step's element; skip steps whose target isn't visible.
  const target = step !== null ? STEPS[step].target : undefined;
  useLayoutEffect(() => {
    if (step === null) return;
    const measure = () => {
      if (!target) {
        setRect(null);
        return;
      }
      const el = document.querySelector(`[data-tour="${target}"]`);
      const r = el?.getBoundingClientRect();
      if (!r || r.width === 0 || r.height === 0) {
        setRect(null);
        return;
      }
      setRect(r);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [step, target]);

  useEffect(() => {
    if (step === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, finish]);

  if (step === null) return null;

  const current = STEPS[step];
  const isFirst = step === 0;
  const isLast = step === STEPS.length - 1;
  const next = () => (isLast ? finish() : setStep(step + 1));

  // Card position: beside the highlighted element, else centred.
  let cardStyle: React.CSSProperties = {
    left: "50%",
    top: "50%",
    transform: "translate(-50%, -50%)",
  };
  if (rect) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const fitsRight = rect.right + GAP + CARD_W < vw;
    const left = fitsRight
      ? rect.right + GAP
      : Math.max(GAP, Math.min(vw - CARD_W - GAP, rect.left + rect.width / 2 - CARD_W / 2));
    const top = fitsRight
      ? Math.max(GAP, Math.min(vh - 200, rect.top))
      : rect.top > vh / 2
        ? Math.max(GAP, rect.top - GAP - 180)
        : rect.bottom + GAP;
    cardStyle = { left, top };
  }

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {rect ? (
        // Spotlight: a transparent box whose huge shadow dims everything else.
        <div
          className="pointer-events-none absolute rounded-lg ring-2 ring-primary transition-all duration-200"
          style={{
            left: rect.left - 4,
            top: rect.top - 4,
            width: rect.width + 8,
            height: rect.height + 8,
            boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.55)",
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/55" />
      )}

      <div
        className="absolute rounded-xl border bg-popover p-4 text-popover-foreground shadow-2xl"
        style={{ width: CARD_W, maxWidth: "calc(100vw - 24px)", ...cardStyle }}
      >
        <div className="flex items-start justify-between gap-2">
          <h2 id="tour-title" className="text-sm font-semibold">
            {current.title}
          </h2>
          <button
            type="button"
            onClick={finish}
            aria-label="Close tour"
            className="-m-1 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground">{current.body}</p>

        <div className="mt-4 flex items-center gap-2">
          {!isFirst && (
            <span className="text-xs text-muted-foreground">
              {step} of {STEPS.length - 1}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            {!isLast && (
              <Button variant="ghost" size="sm" onClick={finish}>
                Skip
              </Button>
            )}
            {!isFirst && !isLast && (
              <Button variant="outline" size="sm" onClick={() => setStep(step - 1)}>
                Back
              </Button>
            )}
            <Button size="sm" onClick={next} autoFocus>
              {isFirst ? "Explore" : isLast ? "Get started" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
