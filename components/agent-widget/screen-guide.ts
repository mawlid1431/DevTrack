"use client";

/**
 * The agent's eyes and pointer inside DevTrack, no screen sharing needed.
 *
 * captureScreenContext(): a compact text snapshot of what the user sees in
 * the app right now (page, headings, visible text, clickable places). It is
 * sent along with every chat message and kept fresh during voice calls, so
 * the agent can answer "what's on my screen" and act on "this issue".
 *
 * showOnScreen(): Loom-style guide. Smoothly zooms the app toward a place,
 * rings it with a pulsing spotlight and a short note, then zooms back out.
 *
 * Only DevTrack's own page is read. Browsers never let a site see other
 * tabs, apps or the desktop without the user sharing their screen.
 */

const MAX_TEXT = 1800;
const MAX_TARGETS = 70;

type Target = { id: string; label: string };

function isVisible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) return false;
  const style = getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
}

function labelOf(el: Element): string {
  const aria = el.getAttribute("aria-label");
  const text = (el as HTMLElement).innerText ?? el.textContent ?? "";
  return (aria || text).replace(/\s+/g, " ").trim().slice(0, 60);
}

/** Elements the agent can point at: tagged places first, then any visible control. */
function collectTargets(): Target[] {
  const out: Target[] = [];
  const seen = new Set<string>();
  const add = (id: string, label: string) => {
    const key = `${id}|${label}`.toLowerCase();
    if (!id || seen.has(key) || out.length >= MAX_TARGETS) return;
    seen.add(key);
    out.push({ id, label });
  };
  document.querySelectorAll("[data-tour], [data-agent-target]").forEach((el) => {
    if (!isVisible(el)) return;
    const id = el.getAttribute("data-agent-target") ?? el.getAttribute("data-tour") ?? "";
    add(id, el.getAttribute("data-agent-label") ?? labelOf(el));
  });
  document.querySelectorAll("[data-app-root] a, [data-app-root] button, [data-app-root] [role=button]").forEach((el) => {
    if (!isVisible(el)) return;
    const label = labelOf(el);
    if (label) add(label, label);
  });
  return out;
}

export function captureScreenContext(): string {
  if (typeof document === "undefined") return "";
  const root = document.querySelector("[data-app-root]") ?? document.body;
  const main = root.querySelector("main") ?? root;
  const headings = Array.from(main.querySelectorAll("h1, h2, h3"))
    .filter(isVisible)
    .map((h) => labelOf(h))
    .filter(Boolean)
    .slice(0, 12);
  const dialog = document.querySelector("[role=dialog]:not([aria-hidden=true]):not([data-agent-panel])");
  const text = ((main as HTMLElement).innerText ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
  const targets = collectTargets();

  return [
    `Page: ${location.pathname.split("/").slice(2).join("/") || "home"} (title: ${document.title})`,
    headings.length ? `Headings: ${headings.join(" | ")}` : "",
    dialog ? `Open dialog: ${labelOf(dialog).slice(0, 200)}` : "",
    `Visible text: ${text}`,
    `Places you can point at with showOnScreen (target id = label): ${targets
      .map((t) => (t.id === t.label ? t.label : `${t.id} = ${t.label}`))
      .join("; ")}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Find a place by tag id, then by exact label, then by partial label. */
function findTarget(query: string): HTMLElement | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const tagged = Array.from(document.querySelectorAll<HTMLElement>("[data-tour], [data-agent-target]")).filter(isVisible);
  const byId = tagged.find(
    (el) => (el.getAttribute("data-agent-target") ?? el.getAttribute("data-tour") ?? "").toLowerCase() === q
  );
  if (byId) return byId;
  const candidates = [
    ...tagged,
    ...Array.from(document.querySelectorAll<HTMLElement>("[data-app-root] a, [data-app-root] button, [data-app-root] [role=button], [data-app-root] h1, [data-app-root] h2")).filter(isVisible),
  ];
  const label = (el: HTMLElement) => (el.getAttribute("data-agent-label") ?? labelOf(el)).toLowerCase();
  return (
    candidates.find((el) => label(el) === q) ??
    candidates.find((el) => label(el).includes(q)) ??
    candidates.find((el) => q.includes(label(el)) && label(el).length > 3) ??
    null
  );
}

let activeGuide: (() => void) | null = null;

/**
 * Zoom toward `query`, spotlight it with `message`, then zoom back out.
 * Retries for a few seconds so it also works right after a page change.
 * Resolves to whether the place was found.
 */
export async function showOnScreen(query: string, message?: string): Promise<boolean> {
  let el: HTMLElement | null = null;
  for (let i = 0; i < 20 && !el; i++) {
    el = findTarget(query);
    if (!el) await new Promise((r) => setTimeout(r, 200));
  }
  if (!el) return false;

  activeGuide?.();
  const root = document.querySelector<HTMLElement>("[data-app-root]");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  el.scrollIntoView({ block: "center", inline: "center", behavior: reduceMotion ? "auto" : "smooth" });
  await new Promise((r) => setTimeout(r, reduceMotion ? 0 : 350));

  // 1. Zoom the app toward the place (Loom-style).
  const start = el.getBoundingClientRect();
  const cx = start.left + start.width / 2;
  const cy = start.top + start.height / 2;
  const scale = reduceMotion ? 1 : Math.min(1.8, Math.max(1.25, 260 / Math.max(start.width, start.height)));
  if (root && scale > 1) {
    root.style.transition = "transform 550ms cubic-bezier(.2,.7,.2,1)";
    root.style.transformOrigin = `${cx}px ${cy}px`;
    root.style.transform = `scale(${scale})`;
  }

  // 2. Spotlight + note, following the element while zoomed.
  const overlay = document.createElement("div");
  overlay.setAttribute("aria-live", "polite");
  overlay.className = "devtrack-guide";
  overlay.innerHTML = `<div class="devtrack-guide-ring"></div>${
    message ? `<div class="devtrack-guide-note"></div>` : ""
  }`;
  if (message) (overlay.querySelector(".devtrack-guide-note") as HTMLElement).textContent = message;
  document.body.appendChild(overlay);
  const ring = overlay.querySelector<HTMLElement>(".devtrack-guide-ring")!;
  const note = overlay.querySelector<HTMLElement>(".devtrack-guide-note");

  let frame = 0;
  const follow = () => {
    const r = el!.getBoundingClientRect();
    ring.style.left = `${r.left - 6}px`;
    ring.style.top = `${r.top - 6}px`;
    ring.style.width = `${r.width + 12}px`;
    ring.style.height = `${r.height + 12}px`;
    if (note) {
      const below = r.bottom + 14 + 60 < window.innerHeight;
      note.style.left = `${Math.max(12, Math.min(window.innerWidth - 292, r.left + r.width / 2 - 140))}px`;
      note.style.top = below ? `${r.bottom + 14}px` : `${Math.max(12, r.top - 14 - note.offsetHeight)}px`;
    }
    frame = requestAnimationFrame(follow);
  };
  follow();

  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(frame);
    overlay.remove();
    if (root) {
      root.style.transform = "";
      setTimeout(() => {
        if (!root.style.transform) {
          root.style.transition = "";
          root.style.transformOrigin = "";
        }
      }, 600);
    }
    window.removeEventListener("pointerdown", cleanup, true);
    window.removeEventListener("keydown", cleanup, true);
    if (activeGuide === cleanup) activeGuide = null;
  };
  activeGuide = cleanup;

  // 3. Hold the zoom, ease back out, keep the ring a little longer.
  setTimeout(() => {
    if (done || !root) return;
    root.style.transform = "";
  }, 2600);
  setTimeout(cleanup, 6000);
  // Any click or key press ends the guide (and the click still goes through).
  setTimeout(() => {
    window.addEventListener("pointerdown", cleanup, true);
    window.addEventListener("keydown", cleanup, true);
  }, 300);
  return true;
}
