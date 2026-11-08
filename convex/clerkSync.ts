import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";

/**
 * Self-heal for missed Clerk webhooks.
 *
 * The workspace shell waits for the Clerk → Convex webhook to mirror the
 * user, org and membership. If a webhook was never delivered (org created
 * before the endpoint existed, endpoint misconfigured, a dropped retry), the
 * app would spin on "Setting up your workspace…" forever. The shell calls
 * this after a short wait: it fetches the signed-in user, their ACTIVE org
 * (from the verified JWT) and that membership straight from the Clerk
 * Backend API — the source of truth — and replays them through the same
 * webhook handlers. Only the caller's own records can be synced.
 */
const CLERK_API = "https://api.clerk.com/v1";

async function clerkGet<T>(path: string, secret: string): Promise<T | null> {
  const res = await fetch(`${CLERK_API}${path}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  if (!res.ok) {
    console.warn(`Clerk API ${path} -> ${res.status}`);
    return null;
  }
  return (await res.json()) as T;
}

export const ensureSynced = action({
  args: {},
  returns: v.object({ user: v.boolean(), org: v.boolean(), membership: v.boolean() }),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    const secret = process.env.CLERK_SECRET_KEY;
    if (!identity || !secret) {
      return { user: false, org: false, membership: false };
    }
    const result = { user: false, org: false, membership: false };

    const user = await clerkGet<{ id: string }>(`/users/${encodeURIComponent(identity.subject)}`, secret);
    if (user?.id === identity.subject) {
      await ctx.runMutation(internal.webhooks.handleClerkEvent, { eventType: "user.updated", data: user });
      result.user = true;
    }

    const orgId = (identity as unknown as { org_id?: string }).org_id;
    if (!orgId || !result.user) return result;

    const org = await clerkGet<{ id: string }>(`/organizations/${encodeURIComponent(orgId)}`, secret);
    if (org?.id !== orgId) return result;

    // Only sync the org if the caller really is a member of it.
    const memberships = await clerkGet<{
      data: { id: string; public_user_data?: { user_id?: string } }[];
    }>(
      `/organizations/${encodeURIComponent(orgId)}/memberships?user_id=${encodeURIComponent(identity.subject)}&limit=1`,
      secret
    );
    const membership = memberships?.data.find((m) => m.public_user_data?.user_id === identity.subject);
    if (!membership) return result;

    await ctx.runMutation(internal.webhooks.handleClerkEvent, { eventType: "organization.updated", data: org });
    result.org = true;
    await ctx.runMutation(internal.webhooks.handleClerkEvent, {
      eventType: "organizationMembership.updated",
      data: membership,
    });
    result.membership = true;
    return result;
  },
});
