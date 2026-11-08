import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

/** Is this Clerk user a synced member of this Clerk org? (used by clerkSync.refreshPlan) */
export const isMember = internalQuery({
  args: { clerkUserId: v.string(), clerkOrgId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkUserId))
      .unique();
    const org = await ctx.db
      .query("organizations")
      .withIndex("by_clerk_org_id", (q) => q.eq("clerkOrgId", args.clerkOrgId))
      .unique();
    if (!user || !org) return false;
    const membership = await ctx.db
      .query("members")
      .withIndex("by_org_and_user", (q) => q.eq("orgId", org._id).eq("userId", user._id))
      .unique();
    return membership !== null;
  },
});
