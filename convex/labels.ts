import { v } from "convex/values";
import { orgMutation, orgQuery } from "./lib/customFunctions";
import { getOrgIssue } from "./issues";

const MAX_LABEL_NAME_LENGTH = 48;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const labelShape = {
  _id: v.id("labels"),
  _creationTime: v.number(),
  orgId: v.id("organizations"),
  name: v.string(),
  color: v.string(),
};

export const list = orgQuery({
  args: {},
  returns: v.array(v.object(labelShape)),
  handler: async (ctx) => {
    return await ctx.db
      .query("labels")
      .withIndex("by_org", (q) => q.eq("orgId", ctx.org._id))
      .collect();
  },
});

export const create = orgMutation({
  args: { name: v.string(), color: v.string() },
  returns: v.id("labels"),
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (!name) {
      throw new Error("Label name cannot be empty");
    }
    if (name.length > MAX_LABEL_NAME_LENGTH) {
      throw new Error(
        `Label names are limited to ${MAX_LABEL_NAME_LENGTH} characters`
      );
    }
    if (!HEX_COLOR.test(args.color)) {
      throw new Error("Label color must be a hex value like #5e6ad2");
    }

    const existing = await ctx.db
      .query("labels")
      .withIndex("by_org", (q) => q.eq("orgId", ctx.org._id))
      .collect();
    if (existing.some((l) => l.name.toLowerCase() === name.toLowerCase())) {
      throw new Error(`A label named "${name}" already exists`);
    }

    return await ctx.db.insert("labels", {
      orgId: ctx.org._id,
      name,
      color: args.color,
    });
  },
});

export const listForIssue = orgQuery({
  args: { issueId: v.id("issues") },
  returns: v.array(v.object(labelShape)),
  handler: async (ctx, args) => {
    await getOrgIssue(ctx, ctx.org._id, args.issueId);
    const links = await ctx.db
      .query("issueLabels")
      .withIndex("by_issue", (q) => q.eq("issueId", args.issueId))
      .collect();
    const labels = [];
    for (const link of links) {
      const label = await ctx.db.get(link.labelId);
      if (label) {
        labels.push(label);
      }
    }
    return labels;
  },
});

export const toggleOnIssue = orgMutation({
  args: { issueId: v.id("issues"), labelId: v.id("labels") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    await getOrgIssue(ctx, ctx.org._id, args.issueId);
    const label = await ctx.db.get(args.labelId);
    if (!label || label.orgId !== ctx.org._id) {
      throw new Error("Label not found");
    }

    const links = await ctx.db
      .query("issueLabels")
      .withIndex("by_issue", (q) => q.eq("issueId", args.issueId))
      .collect();
    const existing = links.find((l) => l.labelId === args.labelId);

    if (existing) {
      await ctx.db.delete(existing._id);
      return false;
    }
    await ctx.db.insert("issueLabels", {
      issueId: args.issueId,
      labelId: args.labelId,
    });
    return true;
  },
});
