import { httpRouter } from "convex/server";
import { Webhook } from "svix";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";

const http = httpRouter();

type ClerkEvent = {
  type: string;
  data: Record<string, unknown>;
};

http.route({
  path: "/clerk-webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.CLERK_WEBHOOK_SECRET;
    if (!secret) {
      console.error("CLERK_WEBHOOK_SECRET is not set");
      return new Response("Webhook secret not configured", { status: 500 });
    }

    const svixId = request.headers.get("svix-id");
    const svixTimestamp = request.headers.get("svix-timestamp");
    const svixSignature = request.headers.get("svix-signature");
    if (!svixId || !svixTimestamp || !svixSignature) {
      return new Response("Missing svix headers", { status: 400 });
    }

    const payload = await request.text();

    let event: ClerkEvent;
    try {
      const wh = new Webhook(secret);
      event = wh.verify(payload, {
        "svix-id": svixId,
        "svix-timestamp": svixTimestamp,
        "svix-signature": svixSignature,
      }) as ClerkEvent;
    } catch (error) {
      console.error("Clerk webhook verification failed", error);
      return new Response("Verification failed", { status: 400 });
    }

    await ctx.runMutation(internal.webhooks.handleClerkEvent, {
      eventType: event.type,
      data: event.data,
    });

    return new Response(null, { status: 200 });
  }),
});

/** Constant-time string compare so the secret can't be guessed by timing. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Called by the LiveKit voice worker (voice-agent/agent.py) for every spoken
 * workspace request. Auth: `Authorization: Bearer <AGENT_SHARED_SECRET>`.
 * The room name selects the (org, user) — the worker never picks them.
 */
http.route({
  path: "/voice-agent/turn",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.AGENT_SHARED_SECRET;
    if (!secret) {
      return Response.json({ error: "AGENT_SHARED_SECRET is not set" }, { status: 500 });
    }
    const auth = request.headers.get("authorization") ?? "";
    if (!safeEqual(auth, `Bearer ${secret}`)) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    let body: { roomName?: unknown; text?: unknown };
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (typeof body.roomName !== "string" || typeof body.text !== "string") {
      return Response.json({ error: "roomName and text are required" }, { status: 400 });
    }
    const live = await ctx.runQuery(internal.agent.voice.sessionIsLive, {
      roomName: body.roomName,
    });
    if (!live) {
      return Response.json({ error: "Voice session not found or expired" }, { status: 404 });
    }
    const result = await ctx.runAction(internal.agent.voice.runVoiceTurn, {
      roomName: body.roomName,
      text: body.text,
    });
    return Response.json(result);
  }),
});

export default http;
