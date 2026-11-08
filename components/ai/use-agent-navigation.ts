"use client";

import type { UIMessage } from "@convex-dev/agent/react";
import { getToolName, isToolUIPart } from "ai";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

type NavigateOutput = { clientAction?: { navigate?: unknown } };

/**
 * Lets the agent drive the screen: when a `navigateTo` tool call finishes in
 * this conversation, route the browser there. Tool calls that already existed
 * when the conversation first loaded are ignored, so re-opening an old chat
 * never jumps around. Paths are workspace-relative and always prefixed with
 * the current org slug, so the agent can't leave the workspace.
 */
export function useAgentNavigation(messages: UIMessage[], ready: boolean) {
  const router = useRouter();
  const { orgSlug } = useParams<{ orgSlug: string }>();
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!ready) return;
    const calls: { id: string; path: string }[] = [];
    for (const message of messages) {
      if (message.role !== "assistant") continue;
      for (const part of message.parts) {
        if (!isToolUIPart(part) || getToolName(part) !== "navigateTo") continue;
        if (part.state !== "output-available") continue;
        const path = (part.output as NavigateOutput | undefined)?.clientAction?.navigate;
        if (typeof path === "string" && (path === "" || path.startsWith("/"))) {
          calls.push({ id: part.toolCallId, path });
        }
      }
    }

    if (seen.current === null) {
      // First load: remember history, act on nothing.
      seen.current = new Set(calls.map((c) => c.id));
      return;
    }
    const fresh = calls.filter((c) => !seen.current!.has(c.id));
    for (const call of fresh) seen.current.add(call.id);
    const last = fresh.at(-1);
    if (last) {
      router.push(`/${orgSlug}${last.path}`);
    }
  }, [messages, ready, router, orgSlug]);
}
