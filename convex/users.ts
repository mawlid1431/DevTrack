import { v } from "convex/values";
import { query } from "./_generated/server";
import { authedMutation } from "./lib/customFunctions";
import { getCurrentUserOrNull } from "./lib/auth";

/**
 * The signed-in user's synced doc, or null while the Clerk webhook sync is
 * in flight. The app shell gates rendering on this.
 */
export const current = query({
  args: {},
  returns: v.union(
    v.object({
      _id: v.id("users"),
      _creationTime: v.number(),
      clerkId: v.string(),
      name: v.string(),
      email: v.string(),
      imageUrl: v.optional(v.string()),
      tourCompletedAt: v.optional(v.number()),
      lastOrgSlug: v.optional(v.string()),
    }),
    v.null()
  ),
  handler: async (ctx) => {
    return await getCurrentUserOrNull(ctx);
  },
});

/** The first-visit tour was finished or skipped: never show it again for this account. */
export const completeTour = authedMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    if (!ctx.user.tourCompletedAt) {
      await ctx.db.patch(ctx.user._id, { tourCompletedAt: Date.now() });
    }
    return null;
  },
});

/** Remember the workspace the user is in, so the next sign-in lands there. */
export const setLastWorkspace = authedMutation({
  args: { slug: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const slug = args.slug.slice(0, 200);
    if (ctx.user.lastOrgSlug !== slug) {
      await ctx.db.patch(ctx.user._id, { lastOrgSlug: slug });
    }
    return null;
  },
});
