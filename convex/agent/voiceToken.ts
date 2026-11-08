"use node";

import { v } from "convex/values";
import { AccessToken, RoomAgentDispatch, RoomConfiguration } from "livekit-server-sdk";
import { internal } from "../_generated/api";
import { action } from "../_generated/server";

type TokenResult =
  | { ok: true; serverUrl: string; token: string }
  | { ok: false; reason: string };

/** Must match AGENT_NAME in voice-agent/agent.py. */
const VOICE_AGENT_NAME = process.env.DEVTRACK_VOICE_AGENT_NAME ?? "devtrack-voice";

/**
 * Mint a LiveKit join token for a room created by `voice.startVoiceSession`.
 * Only the user who started the session can claim it, and only once. The
 * token dispatches the DevTrack voice worker into the room.
 */
export const createVoiceToken = action({
  args: { roomName: v.string() },
  returns: v.union(
    v.object({ ok: v.literal(true), serverUrl: v.string(), token: v.string() }),
    v.object({ ok: v.literal(false), reason: v.string() })
  ),
  handler: async (ctx, args): Promise<TokenResult> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return { ok: false as const, reason: "Sign in again, then start the call." };
    }
    const serverUrl = process.env.LIVEKIT_URL;
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!serverUrl || !apiKey || !apiSecret) {
      return {
        ok: false as const,
        reason: "Voice isn't configured yet: add LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET to the Convex environment.",
      };
    }

    const claim: { userId: string; userName: string } | null = await ctx.runMutation(internal.agent.voice.claimSessionForToken, {
      roomName: args.roomName,
      clerkId: identity.subject,
    });
    if (!claim) {
      return { ok: false as const, reason: "This call link expired. Start the call again." };
    }

    const token = new AccessToken(apiKey, apiSecret, {
      identity: `user-${claim.userId}`,
      name: claim.userName,
      ttl: "2h",
    });
    token.addGrant({
      room: args.roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });
    token.roomConfig = new RoomConfiguration({
      syncStreams: true,
      agents: [new RoomAgentDispatch({ agentName: VOICE_AGENT_NAME })],
    });
    return { ok: true as const, serverUrl, token: await token.toJwt() };
  },
});
