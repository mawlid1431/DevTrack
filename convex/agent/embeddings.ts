import { v } from "convex/values";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { internalAction } from "../_generated/server";
import { orgMutation } from "../lib/customFunctions";
import { hasAiAccess } from "../lib/limits";
import { EMBEDDING_MODEL_ID, embedTexts } from "./models";

const BACKFILL_BATCH_SIZE = 16;

function embeddingSource(): string {
  return EMBEDDING_MODEL_ID ?? "local hashed embeddings";
}

/**
 * Embed one text snippet (1536 dims — `by_embedding` index) with the
 * configured embedding model. Throws if that model fails.
 */
export async function embedText(text: string): Promise<number[]> {
  const [embedding] = await embedTexts([text]);
  return embedding;
}

/**
 * Fill the embedding for a single issue. Scheduled by the agent's
 * create/update mutations. On failure the issue is left without an
 * embedding (never a mismatched one), and the org backfill retries it.
 */
export const embedIssue = internalAction({
  args: { issueId: v.id("issues") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const source = await ctx.runQuery(
      internal.agent.data.issueEmbeddingSource,
      { issueId: args.issueId }
    );
    if (!source) {
      return null;
    }
    try {
      const embedding = await embedText(source.text);
      await ctx.runMutation(internal.agent.data.saveIssueEmbeddings, {
        orgId: source.orgId,
        items: [{ issueId: args.issueId, embedding }],
      });
    } catch (error) {
      console.error(
        `Embedding issue ${args.issueId} with ${embeddingSource()} failed; the backfill will retry`,
        error
      );
    }
    return null;
  },
});

/**
 * Batch-fill embeddings for every issue in an org that is missing one
 * (issues created outside the agent, or while the embedding model was down).
 * Re-schedules itself until the org is fully embedded. On failure it stops;
 * the next `ensureOrgEmbeddings` call (AI surfaces on mount) restarts it.
 */
export const backfillOrgEmbeddings = internalAction({
  args: { orgId: v.id("organizations") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const batch = await ctx.runQuery(
      internal.agent.data.issuesMissingEmbeddings,
      { orgId: args.orgId, limit: BACKFILL_BATCH_SIZE }
    );
    if (batch.length === 0) {
      return null;
    }
    let embeddings: number[][];
    try {
      embeddings = await embedTexts(batch.map((item) => item.text));
    } catch (error) {
      console.error(
        `Embedding backfill with ${embeddingSource()} failed; will retry on next AI page load`,
        error
      );
      return null;
    }
    await ctx.runMutation(internal.agent.data.saveIssueEmbeddings, {
      orgId: args.orgId,
      items: batch.map((item, index) => ({
        issueId: item.issueId,
        embedding: embeddings[index],
      })),
    });
    if (batch.length === BACKFILL_BATCH_SIZE) {
      await ctx.scheduler.runAfter(
        0,
        internal.agent.embeddings.backfillOrgEmbeddings,
        { orgId: args.orgId }
      );
    }
    return null;
  },
});

/**
 * One-off migration: re-embed EVERY issue with the current embedding model.
 * Run after setting or changing AI_EMBED_MODEL, because vectors from
 * different models cannot be compared:
 *
 *   npx convex run agent/embeddings:reembedAllIssues
 *
 * Walks all issues page by page, rescheduling itself until done.
 */
export const reembedAllIssues = internalAction({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const page = await ctx.runQuery(internal.agent.data.issuesPageForReembed, {
      cursor: args.cursor ?? null,
      numItems: BACKFILL_BATCH_SIZE,
    });
    if (page.items.length > 0) {
      const embeddings = await embedTexts(page.items.map((item) => item.text));
      const byOrg = new Map<
        Id<"organizations">,
        Array<{ issueId: Id<"issues">; embedding: number[] }>
      >();
      page.items.forEach((item, index) => {
        const items = byOrg.get(item.orgId) ?? [];
        items.push({ issueId: item.issueId, embedding: embeddings[index] });
        byOrg.set(item.orgId, items);
      });
      for (const [orgId, items] of byOrg) {
        await ctx.runMutation(internal.agent.data.saveIssueEmbeddings, {
          orgId,
          items,
        });
      }
    }
    if (page.isDone) {
      console.log(`Re-embed complete using ${embeddingSource()}`);
    } else {
      await ctx.scheduler.runAfter(
        0,
        internal.agent.embeddings.reembedAllIssues,
        { cursor: page.continueCursor }
      );
    }
    return null;
  },
});

/**
 * Idempotent kick-off for the org embedding backfill. Called from the AI
 * surfaces on mount; cheap no-op when everything is already embedded.
 */
export const ensureOrgEmbeddings = orgMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx): Promise<null> => {
    if (!hasAiAccess(ctx.org)) {
      return null;
    }
    const missing = await ctx.db
      .query("issues")
      .withIndex("by_org", (q) => q.eq("orgId", ctx.org._id))
      // eslint-disable-next-line @convex-dev/no-filter-in-query
      .filter((q) => q.eq(q.field("embedding"), undefined))
      .take(1);
    if (missing.length > 0) {
      await ctx.scheduler.runAfter(
        0,
        internal.agent.embeddings.backfillOrgEmbeddings,
        { orgId: ctx.org._id }
      );
    }
    return null;
  },
});
