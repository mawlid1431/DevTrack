import { components } from "../_generated/api";
import type { DevTrackToolCtx } from "./tools";

/**
 * Server-enforced confirmation for create / delete / workspace actions.
 *
 * 1. The tool is called without a code -> nothing happens. It returns a
 *    `needs_confirmation` preview plus a code bound to (tool, exact
 *    arguments, the user's CURRENT message).
 * 2. The agent shows the preview and asks the user.
 * 3. The tool only runs when called again with that code AND:
 *    - the code was issued for the user's PREVIOUS message (so a new user
 *      message has arrived since the preview — the model can't confirm on
 *      its own within one turn), and
 *    - that new message is an explicit yes, and
 *    - the arguments are unchanged.
 *
 * Only workspace-wide actions go through this gate (see CONFIRM_REQUIRED).
 * Everything else — creating/deleting issues, projects and templates — runs
 * immediately: deletes are soft (recycle bin, restorable for 30 days), so
 * acting at once is safe and is what users expect from the agent.
 */

/** Tools that still need an explicit "yes" before they run. */
export const CONFIRM_REQUIRED: ReadonlySet<string> = new Set([
  "applyWorkspaceTemplate",
  "createWorkspace",
]);

export type NeedsConfirmation = {
  status: "needs_confirmation";
  summary: string;
  confirmationCode: string;
  instructions: string;
};

/** FNV-1a 32-bit hash: binds a code to its exact action (not a secret). */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, "0");
}

/** Deterministic JSON (sorted keys) so the same args always hash the same. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const NEGATIVE = /\b(no|nope|nah|don'?t|do not|cancel|stop|wait|hold on|not yet|never)\b/i;
const AFFIRMATIVE =
  /\b(yes|yeah|yep|yup|y|sure|ok|okay|confirm|confirmed|go ahead|do it|proceed|approve|approved|please do|correct|sounds good|that'?s right|haa|haye|ya|ndiyo|oui|si|sí)\b/i;

export function isAffirmative(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && t.length <= 200 && AFFIRMATIVE.test(t) && !NEGATIVE.test(t);
}

type ThreadMessage = {
  _id: string;
  message?: { role: string; content: unknown };
};

function messageText(msg: ThreadMessage): string {
  const content = msg.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === "object" && "text" in part ? String(part.text) : ""))
      .join(" ");
  }
  return "";
}

/** The two most recent user messages in this thread (newest first). */
async function recentUserMessages(ctx: DevTrackToolCtx): Promise<ThreadMessage[]> {
  if (!ctx.threadId) return [];
  const result = await ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
    threadId: ctx.threadId,
    order: "desc",
    excludeToolMessages: true,
    paginationOpts: { cursor: null, numItems: 30 },
  });
  return (result.page as ThreadMessage[]).filter((m) => m.message?.role === "user").slice(0, 2);
}

/**
 * Returns `null` when the action is confirmed and may run; otherwise a
 * `needs_confirmation` result to hand back to the model.
 */
export async function requireConfirmation(
  ctx: DevTrackToolCtx,
  toolName: string,
  args: Record<string, unknown>,
  summary: string,
  confirmationCode: string | undefined
): Promise<NeedsConfirmation | null> {
  if (!CONFIRM_REQUIRED.has(toolName)) {
    return null;
  }
  const [latest, previous] = await recentUserMessages(ctx);
  const actionKey = `${toolName}|${stableStringify(args)}`;

  if (confirmationCode && latest && previous) {
    const issuedForPrevious = fnv1a(`${actionKey}|${previous._id}`) === confirmationCode;
    if (issuedForPrevious && isAffirmative(messageText(latest))) {
      return null;
    }
  }

  return {
    status: "needs_confirmation",
    summary,
    confirmationCode: fnv1a(`${actionKey}|${latest?._id ?? "none"}`),
    instructions:
      "Nothing has been changed yet. Show the user this exact summary, ask any clarifying question you still have, and ask them to reply yes to confirm. Only after they reply yes in a NEW message, call this tool again with exactly the same arguments plus this confirmationCode. If they change anything, call without a code to get a fresh preview.",
  };
}
