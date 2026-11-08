import { createThread as createAgentThread, saveMessage } from "@convex-dev/agent";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { orgMutation } from "../lib/customFunctions";
import { hasAiAccess } from "../lib/limits";
import { DEVTRACK_INSTRUCTIONS, devTrackAgent } from "./devTrackAgent";
import {
  PRO_DAILY_MESSAGE_LIMIT,
  aiMessageKey,
  aiRateLimiter,
  threadUserKey,
} from "./limiter";
import { assertAiConfigured, userFacingAiError } from "./models";

/**
 * Live voice conversations (LiveKit).
 *
 * 1. The browser calls `startVoiceSession` (authenticated, org-scoped). It
 *    binds a fresh LiveKit room name to this (org, user, thread).
 * 2. The browser calls `voiceToken.createVoiceToken` to get a join token;
 *    the token also dispatches the DevTrack voice worker into that room.
 * 3. The worker (voice-agent/agent.py) hears the user and, for anything
 *    about the workspace, POSTs to the `/voice-agent/turn` HTTP route with the
 *    shared secret + room name. `runVoiceTurn` then runs the SAME DevTrack
 *    agent and tools as text chat, inside the session's org, as that user.
 *    Everything is saved to the thread, so the floating panel shows the
 *    transcript and `navigateTo` moves the user's screen.
 */

const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const VOICE_THREAD_TITLE = "Voice conversation";

export const startVoiceSession = orgMutation({
  args: { threadId: v.optional(v.string()) },
  returns: v.object({ roomName: v.string(), threadId: v.string() }),
  handler: async (ctx, args) => {
    if (!hasAiAccess(ctx.org)) {
      throw new Error("The AI agent requires a Pro or Enterprise plan. Upgrade to unlock it.");
    }
    const owner = threadUserKey(ctx.org._id, ctx.user._id);
    let threadId = args.threadId;
    if (threadId) {
      const thread = await ctx.runQuery(components.agent.threads.getThread, { threadId });
      if (!thread || thread.userId !== owner) {
        throw new Error("Thread not found");
      }
    } else {
      threadId = await createAgentThread(ctx, components.agent, {
        userId: owner,
        title: VOICE_THREAD_TITLE,
      });
    }
    const roomName = `devtrack-${crypto.randomUUID()}`;
    await ctx.db.insert("voiceSessions", {
      orgId: ctx.org._id,
      userId: ctx.user._id,
      threadId,
      roomName,
      expiresAt: Date.now() + SESSION_TTL_MS,
      tokenIssued: false,
    });
    return { roomName, threadId };
  },
});

/** Used by voiceToken.ts to check the caller owns the room before minting. */
export const claimSessionForToken = internalMutation({
  args: { roomName: v.string(), clerkId: v.string() },
  returns: v.union(
    v.object({ userId: v.id("users"), userName: v.string() }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("voiceSessions")
      .withIndex("by_room", (q) => q.eq("roomName", args.roomName))
      .unique();
    if (!session || session.tokenIssued || session.expiresAt < Date.now()) {
      return null;
    }
    const user = await ctx.db.get(session.userId);
    if (!user || user.clerkId !== args.clerkId) {
      return null;
    }
    await ctx.db.patch(session._id, { tokenIssued: true });
    return { userId: user._id, userName: user.name };
  },
});

/** Save the spoken request into the thread (with the same quota as chat). */
export const recordVoiceMessage = internalMutation({
  args: { roomName: v.string(), text: v.string() },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      messageId: v.string(),
      threadId: v.string(),
      orgId: v.id("organizations"),
      userId: v.id("users"),
    }),
    v.object({ ok: v.literal(false), reply: v.string() })
  ),
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("voiceSessions")
      .withIndex("by_room", (q) => q.eq("roomName", args.roomName))
      .unique();
    if (!session || session.expiresAt < Date.now()) {
      return { ok: false as const, reply: "This voice session has ended. Start a new call." };
    }
    const org = await ctx.db.get(session.orgId);
    if (!org || !hasAiAccess(org)) {
      return { ok: false as const, reply: "The AI agent needs a Pro or Enterprise plan." };
    }
    if (org.plan === "pro") {
      const status = await aiRateLimiter.limit(ctx, "aiMessagesDaily", {
        key: aiMessageKey(session.orgId, session.userId),
      });
      if (!status.ok) {
        return {
          ok: false as const,
          reply: `You've used today's ${PRO_DAILY_MESSAGE_LIMIT} AI messages. Upgrade to Enterprise for unlimited AI.`,
        };
      }
    }
    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId: session.threadId,
      userId: threadUserKey(session.orgId, session.userId),
      prompt: args.text,
    });
    return {
      ok: true as const,
      messageId,
      threadId: session.threadId,
      orgId: session.orgId,
      userId: session.userId,
    };
  },
});

/** Run one spoken request through the DevTrack agent and return the reply. */
export const runVoiceTurn = internalAction({
  args: { roomName: v.string(), text: v.string() },
  returns: v.object({ reply: v.string() }),
  handler: async (ctx, args): Promise<{ reply: string }> => {
    const text = args.text.trim().slice(0, 4000);
    if (!text) return { reply: "I didn't catch that." };

    const recorded = await ctx.runMutation(internal.agent.voice.recordVoiceMessage, {
      roomName: args.roomName,
      text,
    });
    if (!recorded.ok) return { reply: recorded.reply };

    const actor = await ctx.runQuery(internal.agent.data.actorContext, {
      orgId: recorded.orgId,
      userId: recorded.userId,
    });
    try {
      assertAiConfigured();
      const result = await devTrackAgent.generateText(
        { ...ctx, orgId: recorded.orgId, requestUserId: recorded.userId },
        { threadId: recorded.threadId, userId: threadUserKey(recorded.orgId, recorded.userId) },
        {
          promptMessageId: recorded.messageId,
          system: `${DEVTRACK_INSTRUCTIONS}\n\nThis request was SPOKEN in a live voice call; your reply will be read aloud. Act immediately, then answer in one to three short plain sentences — no markdown, lists or tables.\n\nWorkspace: ${actor.orgName}. Requesting user: ${actor.userName}. Today's date: ${new Date().toISOString().slice(0, 10)}.`,
        }
      );
      return { reply: result.text || "Done." };
    } catch (error) {
      console.error("Voice turn failed", error);
      const reason = userFacingAiError(error);
      await saveMessage(ctx, components.agent, {
        threadId: recorded.threadId,
        userId: threadUserKey(recorded.orgId, recorded.userId),
        agentName: "DevTrack",
        message: { role: "assistant", content: reason },
      });
      return { reply: reason };
    }
  },
});

/** Read-only check used by the HTTP route before doing any work. */
export const sessionIsLive = internalQuery({
  args: { roomName: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("voiceSessions")
      .withIndex("by_room", (q) => q.eq("roomName", args.roomName))
      .unique();
    return session !== null && session.expiresAt > Date.now();
  },
});
