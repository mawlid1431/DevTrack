import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

const DAY = 24 * 60 * 60 * 1000;

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { clerkId: "user_c", name: "User C", email: "c@example.com" });
    const orgId = await ctx.db.insert("organizations", { clerkOrgId: "org_c", name: "Org C", slug: "c", plan: "pro" });
    await ctx.db.insert("members", { orgId, userId, role: "admin", clerkMembershipId: "mem_c" });
    const teamId = await ctx.db.insert("teams", { orgId, name: "Engineering", key: "ENG", nextIssueNumber: 1 });
    return { userId, orgId, teamId };
  });
  const as = t.withIdentity({ subject: "user_c", org_id: "org_c" } as never);
  return { t, as, ...ids };
}

describe("cycles", () => {
  test("cycles are numbered per team and can't overlap", async () => {
    const { as, teamId } = await setup();
    const now = Date.now();
    const a = await as.mutation(api.cycles.create, { teamId, startDate: now, endDate: now + 14 * DAY });
    await expect(
      as.mutation(api.cycles.create, { teamId, startDate: now + DAY, endDate: now + 3 * DAY })
    ).rejects.toThrow(/overlap/);
    await expect(
      as.mutation(api.cycles.create, { teamId, startDate: now + 30 * DAY, endDate: now + 29 * DAY })
    ).rejects.toThrow(/after its start/);
    const b = await as.mutation(api.cycles.create, {
      teamId,
      startDate: now + 14 * DAY + 1,
      endDate: now + 28 * DAY,
    });
    const cycles = await as.query(api.cycles.listByTeam, { teamId });
    expect(cycles.map((c) => [c._id, c.number])).toEqual([
      [b, 2],
      [a, 1],
    ]);
    const current = await as.query(api.cycles.currentForTeam, { teamId });
    expect(current?._id).toBe(a);
  });

  test("an ended cycle rolls unfinished issues into a new next cycle, once", async () => {
    const { t, as, teamId } = await setup();
    const now = Date.now();
    const ended = await as.mutation(api.cycles.create, {
      teamId,
      startDate: now - 10 * DAY,
      endDate: now - 60 * 60 * 1000,
    });
    const open = await as.mutation(api.issues.create, { teamId, title: "Open", cycleId: ended });
    const done = await as.mutation(api.issues.create, { teamId, title: "Done", cycleId: ended, status: "done" });

    const first = await t.mutation(internal.cycles.rollOverEnded, {});
    expect(first).toMatchObject({ issuesMoved: 1, cyclesCreated: 1 });

    const cycles = await as.query(api.cycles.listByTeam, { teamId });
    expect(cycles).toHaveLength(2);
    const next = cycles.find((c) => c._id !== ended)!;
    expect(next.number).toBe(2);
    const old = cycles.find((c) => c._id === ended)!;
    expect(next.startDate).toBe(old.endDate + 1);
    expect(next.endDate - next.startDate).toBe(old.endDate - old.startDate);

    expect((await as.query(api.issues.get, { issueId: open }))?.cycleId).toBe(next._id);
    expect((await as.query(api.issues.get, { issueId: done }))?.cycleId).toBe(ended);

    const second = await t.mutation(internal.cycles.rollOverEnded, {});
    expect(second).toMatchObject({ cycles: 0, issuesMoved: 0, cyclesCreated: 0 });
  });

  test("rollover uses the team's existing next cycle instead of creating one", async () => {
    const { t, as, teamId } = await setup();
    const now = Date.now();
    const ended = await as.mutation(api.cycles.create, { teamId, startDate: now - 7 * DAY, endDate: now - 1000 });
    const upcoming = await as.mutation(api.cycles.create, { teamId, startDate: now, endDate: now + 7 * DAY });
    const issue = await as.mutation(api.issues.create, { teamId, title: "Carry me", cycleId: ended });

    const result = await t.mutation(internal.cycles.rollOverEnded, {});
    expect(result).toMatchObject({ issuesMoved: 1, cyclesCreated: 0 });
    expect((await as.query(api.issues.get, { issueId: issue }))?.cycleId).toBe(upcoming);
  });

  test("cycles that ended long ago are only marked, never moved", async () => {
    const { t, as, teamId } = await setup();
    const now = Date.now();
    const old = await as.mutation(api.cycles.create, { teamId, startDate: now - 60 * DAY, endDate: now - 30 * DAY });
    const issue = await as.mutation(api.issues.create, { teamId, title: "History", cycleId: old });

    const result = await t.mutation(internal.cycles.rollOverEnded, {});
    expect(result).toMatchObject({ cycles: 1, issuesMoved: 0, cyclesCreated: 0 });
    expect((await as.query(api.issues.get, { issueId: issue }))?.cycleId).toBe(old);
  });
});
