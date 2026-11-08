"use client";

import { useClerk } from "@clerk/nextjs";
import type { UIMessage } from "@convex-dev/agent/react";
import { isToolUIPart } from "ai";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { showOnScreen } from "@/components/agent-widget/screen-guide";

type ClientAction = {
  /** Workspace-relative path to open, e.g. "/projects" ("" = home). */
  navigate?: unknown;
  /** Slug of a workspace to switch to (just created by the agent). */
  switchWorkspace?: unknown;
  /** Log the user out. */
  signOut?: unknown;
  /** Zoom in on and spotlight a place on screen. */
  highlight?: { target?: unknown; message?: unknown };
};

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Lets the agent act on the user's screen, live, from text chat or a voice
 * call: when a tool result in this conversation carries a `clientAction`,
 * the browser carries it out (open a page, switch workspace, log out).
 *
 * Tool calls that already existed when the conversation first loaded are
 * ignored, so re-opening an old chat never replays them. Paths are always
 * prefixed with the current workspace slug and slugs are validated, so the
 * agent can't send the user to another site.
 */
export function useAgentActions(messages: UIMessage[], ready: boolean) {
  const router = useRouter();
  const { signOut } = useClerk();
  const { orgSlug } = useParams<{ orgSlug: string }>();
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!ready) return;
    const actions: { id: string; action: ClientAction }[] = [];
    for (const message of messages) {
      if (message.role !== "assistant") continue;
      for (const part of message.parts) {
        if (!isToolUIPart(part) || part.state !== "output-available") continue;
        const action = (part.output as { clientAction?: ClientAction } | undefined)?.clientAction;
        if (action && typeof action === "object") {
          actions.push({ id: part.toolCallId, action });
        }
      }
    }

    if (seen.current === null) {
      // First load: remember history, act on nothing.
      seen.current = new Set(actions.map((a) => a.id));
      return;
    }
    const fresh = actions.filter((a) => !seen.current!.has(a.id));
    for (const a of fresh) seen.current.add(a.id);
    if (fresh.length === 0) return;

    // Logging out wins over everything else in the same reply.
    if (fresh.some((a) => a.action.signOut === true)) {
      // Let the spoken/typed goodbye land first.
      setTimeout(() => void signOut({ redirectUrl: "/" }), 1200);
      return;
    }
    const switchTo = fresh.findLast((a) => typeof a.action.switchWorkspace === "string");
    const slug = switchTo?.action.switchWorkspace as string | undefined;
    if (slug && SLUG.test(slug)) {
      // Full load so Clerk picks up the brand-new membership.
      window.location.assign(`/${slug}`);
      return;
    }
    const nav = fresh.findLast((a) => typeof a.action.navigate === "string");
    const path = nav?.action.navigate as string | undefined;
    if (path !== undefined && (path === "" || /^\/[\w\-/?=&.]*$/.test(path))) {
      router.push(`/${orgSlug}${path}`);
    }
    // Point at a place (after any page change above; the guide waits for it).
    const guide = fresh.findLast((a) => typeof a.action.highlight?.target === "string");
    if (guide) {
      const { target, message } = guide.action.highlight as { target: string; message?: unknown };
      void showOnScreen(target, typeof message === "string" ? message : undefined).then((found) => {
        if (!found) console.warn(`DevTrack AI couldn't find "${target}" on screen`);
      });
    }
  }, [messages, ready, router, orgSlug, signOut]);
}
