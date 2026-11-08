import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { QueryCtx, internalMutation } from "./_generated/server";
import { issueShape } from "./issues";
import { orgMutation, orgQuery } from "./lib/customFunctions";
import { progressShape } from "./projects";
import { trashCycle } from "./trash";

export const cycleShape = {
  _id: v.id("cycles"),
  _creationTime: v.number(),
  orgId: v.id("organizations"),
  teamId: v.id("teams"),
  number: v.number(),
  name: v.optional(v.string()),
  startDate: v.number(),
  endDate: v.number(),
  rolledOverAt: v.optional(v.number()),
};

/** Verify a cycle belongs to the caller's org before any read/write. */
async function getOrgCycle(
  ctx: { db: QueryCtx["db"] },
  orgId: Id<"organizations">,
  cycleId: Id<"cycles">
): Promise<Doc<"cycles">> {
  const cycle = await ctx.db.get(cycleId);
  if (!cycle || cycle.orgId !== orgId) {
    throw new Error("Cycle not found");
  }
  return cycle;
}

/** Verify a team belongs to the caller's org. */
async function getOrgTeam(
  ctx: { db: QueryCtx["db"] },
  orgId: Id<"organizations">,
  teamId: Id<"teams">
): Promise<Doc<"teams">> {
  const team = await ctx.db.get(teamId);
  if (!team || team.orgId !== orgId) {
    throw new Error("Team not found");
  }
  return team;
}

async function countProgress(
  ctx: { db: QueryCtx["db"] },
  orgId: Id<"organizations">,
  cycleId: Id<"cycles">
) {
  const issues = await ctx.db
    .query("issues")
    .withIndex("by_cycle", (q) => q.eq("cycleId", cycleId))
    .collect();
  const progress = {
    total: 0,
    backlog: 0,
    todo: 0,
    in_progress: 0,
    in_review: 0,
    done: 0,
    canceled: 0,
  };
  for (const issue of issues) {
    if (issue.orgId !== orgId) {
      continue;
    }
    progress.total += 1;
    progress[issue.status] += 1;
  }
  return progress;
}

/** Cycles for one team, newest first (lightweight, for pickers). */
export const listByTeam = orgQuery({
  args: { teamId: v.id("teams") },
  returns: v.array(v.object(cycleShape)),
  handler: async (ctx, args) => {
    await getOrgTeam(ctx, ctx.org._id, args.teamId);
    return await ctx.db
      .query("cycles")
      .withIndex("by_team_and_number", (q) => q.eq("teamId", args.teamId))
      .order("desc")
      .collect();
  },
});

/**
 * Every cycle in the org with team info and per-status issue counts , 
 * powers the cycles index page.
 */
export const listWithProgress = orgQuery({
  args: {},
  returns: v.array(
    v.object({
      ...cycleShape,
      teamName: v.string(),
      teamKey: v.string(),
      progress: progressShape,
    })
  ),
  handler: async (ctx) => {
    const teams = await ctx.db
      .query("teams")
      .withIndex("by_org", (q) => q.eq("orgId", ctx.org._id))
      .collect();
    const result = [];
    for (const team of teams) {
      const cycles = await ctx.db
        .query("cycles")
        .withIndex("by_team_and_number", (q) => q.eq("teamId", team._id))
        .order("desc")
        .collect();
      for (const cycle of cycles) {
        result.push({
          ...cycle,
          teamName: team.name,
          teamKey: team.key,
          progress: await countProgress(ctx, ctx.org._id, cycle._id),
        });
      }
    }
    return result;
  },
});

export const get = orgQuery({
  args: { cycleId: v.id("cycles") },
  returns: v.union(v.object(cycleShape), v.null()),
  handler: async (ctx, args) => {
    const cycle = await ctx.db.get(args.cycleId);
    if (!cycle || cycle.orgId !== ctx.org._id) {
      return null;
    }
    return cycle;
  },
});

/**
 * The team's current cycle, the active cycle (startDate ≤ now ≤ endDate)
 * with the most recent start, or null when no cycle is running.
 */
export const currentForTeam = orgQuery({
  args: { teamId: v.id("teams") },
  returns: v.union(v.object(cycleShape), v.null()),
  handler: async (ctx, args) => {
    await getOrgTeam(ctx, ctx.org._id, args.teamId);
    const cycles = await ctx.db
      .query("cycles")
      .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
      .collect();
    const now = Date.now();
    const active = cycles
      .filter((cycle) => cycle.startDate <= now && now <= cycle.endDate)
      .sort((a, b) => b.startDate - a.startDate);
    return active[0] ?? null;
  },
});

/** All issues scheduled into a cycle (detail page computes progress from this). */
export const listIssues = orgQuery({
  args: { cycleId: v.id("cycles") },
  returns: v.array(v.object(issueShape)),
  handler: async (ctx, args) => {
    await getOrgCycle(ctx, ctx.org._id, args.cycleId);
    const issues = await ctx.db
      .query("issues")
      .withIndex("by_cycle", (q) => q.eq("cycleId", args.cycleId))
      .collect();
    return issues.filter((issue) => issue.orgId === ctx.org._id);
  },
});

/**
 * Team issues NOT already in the given cycle, candidates for the
 * "add issues to cycle" picker. Assignment itself goes through
 * `issues.update` (cycleId arg).
 */
export const candidateIssues = orgQuery({
  args: { cycleId: v.id("cycles") },
  returns: v.array(v.object(issueShape)),
  handler: async (ctx, args) => {
    const cycle = await getOrgCycle(ctx, ctx.org._id, args.cycleId);
    const issues = await ctx.db
      .query("issues")
      .withIndex("by_team", (q) => q.eq("teamId", cycle.teamId))
      .order("desc")
      .take(500);
    return issues
      .filter(
        (issue) => issue.orgId === ctx.org._id && issue.cycleId !== args.cycleId
      )
      .slice(0, 200);
  },
});

/**
 * A team runs one cycle at a time. Reject a date range that overlaps any of
 * the team's other cycles (back-to-back cycles sharing a boundary are fine).
 */
export async function assertNoOverlap(
  ctx: { db: QueryCtx["db"] },
  teamId: Id<"teams">,
  startDate: number,
  endDate: number,
  excludeCycleId?: Id<"cycles">
): Promise<void> {
  const cycles = await ctx.db
    .query("cycles")
    .withIndex("by_team", (q) => q.eq("teamId", teamId))
    .collect();
  const clash = cycles.find(
    (other) =>
      other._id !== excludeCycleId &&
      startDate < other.endDate &&
      other.startDate < endDate
  );
  if (clash) {
    throw new Error(
      `These dates overlap ${clash.name ?? `Cycle ${clash.number}`}`
    );
  }
}

/** Create a cycle for a team. Cycles are auto-numbered per team (Cycle 1, 2, …). */
export const create = orgMutation({
  args: {
    teamId: v.id("teams"),
    name: v.optional(v.string()),
    startDate: v.number(),
    endDate: v.number(),
  },
  returns: v.id("cycles"),
  handler: async (ctx, args) => {
    await getOrgTeam(ctx, ctx.org._id, args.teamId);
    if (args.endDate <= args.startDate) {
      throw new Error("Cycle end date must be after its start date");
    }
    await assertNoOverlap(ctx, args.teamId, args.startDate, args.endDate);

    // Claim the next per-team cycle number.
    const latest = await ctx.db
      .query("cycles")
      .withIndex("by_team_and_number", (q) => q.eq("teamId", args.teamId))
      .order("desc")
      .first();
    const number = (latest?.number ?? 0) + 1;

    const name = args.name?.trim();
    return await ctx.db.insert("cycles", {
      orgId: ctx.org._id,
      teamId: args.teamId,
      number,
      name: name ? name : undefined,
      startDate: args.startDate,
      endDate: args.endDate,
    });
  },
});

export const update = orgMutation({
  args: {
    cycleId: v.id("cycles"),
    name: v.optional(v.union(v.string(), v.null())),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const cycle = await getOrgCycle(ctx, ctx.org._id, args.cycleId);

    const startDate = args.startDate ?? cycle.startDate;
    const endDate = args.endDate ?? cycle.endDate;
    if (endDate <= startDate) {
      throw new Error("Cycle end date must be after its start date");
    }
    if (args.startDate !== undefined || args.endDate !== undefined) {
      await assertNoOverlap(ctx, cycle.teamId, startDate, endDate, cycle._id);
    }

    const updates: Partial<Doc<"cycles">> = {};
    if (args.name !== undefined) {
      const name = args.name?.trim();
      updates.name = name ? name : undefined;
    }
    if (args.startDate !== undefined) {
      updates.startDate = args.startDate;
    }
    if (args.endDate !== undefined) {
      updates.endDate = args.endDate;
    }

    await ctx.db.patch(cycle._id, updates);
    return null;
  },
});

/** Delete a cycle and unschedule its issues (issues themselves are kept). */
export const remove = orgMutation({
  args: { cycleId: v.id("cycles") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const cycle = await getOrgCycle(ctx, ctx.org._id, args.cycleId);
    // Recycle bin: issues are unscheduled now and re-scheduled on restore.
    await trashCycle(ctx, ctx.org._id, ctx.user._id, cycle);
    return null;
  },
});

/**
 * Rollover: when a cycle ends, its unfinished issues (anything not done or
 * canceled) move into the team's next cycle. If the team has no next cycle,
 * one of the same length is created to start right after. Runs hourly
 * (crons.ts); each ended cycle is processed once (rolledOverAt).
 *
 * Cycles that ended long before this feature existed are only marked, not
 * rolled, so old history never suddenly moves (ROLLOVER_WINDOW_MS).
 */
const ROLLOVER_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;
const ROLLOVER_BATCH = 50;

export const rollOverEnded = internalMutation({
  args: {},
  returns: v.object({ cycles: v.number(), issuesMoved: v.number(), cyclesCreated: v.number() }),
  handler: async (ctx) => {
    const now = Date.now();
    const ended = await ctx.db
      .query("cycles")
      .withIndex("by_rolled_and_end", (q) => q.eq("rolledOverAt", undefined).lt("endDate", now))
      .take(ROLLOVER_BATCH);

    let issuesMoved = 0;
    let cyclesCreated = 0;
    for (const cycle of ended) {
      await ctx.db.patch(cycle._id, { rolledOverAt: now });
      if (now - cycle.endDate > ROLLOVER_WINDOW_MS) {
        continue;
      }
      const unfinished = (
        await ctx.db
          .query("issues")
          .withIndex("by_cycle", (q) => q.eq("cycleId", cycle._id))
          .collect()
      ).filter((i) => i.orgId === cycle.orgId && i.status !== "done" && i.status !== "canceled");
      if (unfinished.length === 0) {
        continue;
      }

      // The team's next cycle: the earliest one starting at or after this end.
      const teamCycles = await ctx.db
        .query("cycles")
        .withIndex("by_team", (q) => q.eq("teamId", cycle.teamId))
        .collect();
      let next = teamCycles
        .filter((c) => c._id !== cycle._id && c.startDate >= cycle.endDate)
        .sort((a, b) => a.startDate - b.startDate)[0];

      if (!next) {
        const latest = teamCycles.reduce((max, c) => Math.max(max, c.number), 0);
        const length = cycle.endDate - cycle.startDate;
        const startDate = cycle.endDate + 1;
        const nextId = await ctx.db.insert("cycles", {
          orgId: cycle.orgId,
          teamId: cycle.teamId,
          number: latest + 1,
          startDate,
          endDate: startDate + length,
        });
        next = (await ctx.db.get(nextId))!;
        cyclesCreated += 1;
      }

      for (const issue of unfinished) {
        await ctx.db.patch(issue._id, { cycleId: next._id });
        issuesMoved += 1;
      }
    }
    return { cycles: ended.length, issuesMoved, cyclesCreated };
  },
});
