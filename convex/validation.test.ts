import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import schema from "./schema";
import { modules } from "./test.setup";

type Tester = ReturnType<typeof convexTest>;

/** Create an org with one admin member and one team; return a signed-in client. */
async function setupOrg(t: Tester, slug: string) {
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      clerkId: `user_${slug}`,
      name: `User ${slug}`,
      email: `${slug}@example.com`,
    });
    const orgId = await ctx.db.insert("organizations", {
      clerkOrgId: `org_${slug}`,
      name: `Org ${slug}`,
      slug,
      plan: "pro",
    });
    await ctx.db.insert("members", {
      orgId,
      userId,
      role: "admin",
      clerkMembershipId: `mem_${slug}`,
    });
    const teamId = await ctx.db.insert("teams", {
      orgId,
      name: "Engineering",
      key: "ENG",
      nextIssueNumber: 1,
    });
    return { userId, orgId, teamId };
  });
  const as = t.withIdentity({
    subject: `user_${slug}`,
    org_id: `org_${slug}`,
  } as never);
  return { ...ids, as };
}

describe("issues", () => {
  test("rejects empty titles and trims valid ones", async () => {
    const t = convexTest(schema, modules);
    const { as, teamId } = await setupOrg(t, "a");
    await expect(
      as.mutation(api.issues.create, { teamId, title: "   " })
    ).rejects.toThrow("Issue title cannot be empty");
    const id = await as.mutation(api.issues.create, {
      teamId,
      title: "  Fix login  ",
    });
    const issue = await t.run((ctx) => ctx.db.get(id));
    expect(issue?.title).toBe("Fix login");
  });

  test("rejects references to another organization", async () => {
    const t = convexTest(schema, modules);
    const a = await setupOrg(t, "a");
    const b = await setupOrg(t, "b");
    await expect(
      a.as.mutation(api.issues.create, {
        teamId: a.teamId,
        title: "Cross-tenant",
        assigneeId: b.userId,
      })
    ).rejects.toThrow("Assignee must be a member of this organization");

    const otherIssue = await b.as.mutation(api.issues.create, {
      teamId: b.teamId,
      title: "Org B issue",
    });
    await expect(
      a.as.mutation(api.issues.create, {
        teamId: a.teamId,
        title: "Child",
        parentIssueId: otherIssue,
      })
    ).rejects.toThrow("Issue not found");
  });

  test("validates estimates", async () => {
    const t = convexTest(schema, modules);
    const { as, teamId } = await setupOrg(t, "a");
    for (const estimate of [-1, 2.5, 101, Number.NaN]) {
      await expect(
        as.mutation(api.issues.create, { teamId, title: "x", estimate })
      ).rejects.toThrow("Estimate must be a whole number");
    }
    await as.mutation(api.issues.create, { teamId, title: "ok", estimate: 5 });
  });

  test("deleting an issue removes comments and unparents sub-issues", async () => {
    const t = convexTest(schema, modules);
    const { as, teamId } = await setupOrg(t, "a");
    const parent = await as.mutation(api.issues.create, {
      teamId,
      title: "Parent",
    });
    const child = await as.mutation(api.issues.create, {
      teamId,
      title: "Child",
      parentIssueId: parent,
    });
    await as.mutation(api.comments.create, { issueId: parent, body: "hi" });

    await as.mutation(api.issues.remove, { issueId: parent });

    const leftovers = await t.run(async (ctx) => ({
      comments: await ctx.db
        .query("comments")
        .withIndex("by_issue", (q) => q.eq("issueId", parent))
        .collect(),
      activity: await ctx.db
        .query("activity")
        .withIndex("by_issue", (q) => q.eq("issueId", parent))
        .collect(),
      child: await ctx.db.get(child as Id<"issues">),
    }));
    expect(leftovers.comments).toHaveLength(0);
    expect(leftovers.activity).toHaveLength(0);
    expect(leftovers.child?.parentIssueId).toBeUndefined();
  });
});

describe("labels", () => {
  test("rejects empty, duplicate and non-hex labels", async () => {
    const t = convexTest(schema, modules);
    const { as } = await setupOrg(t, "a");
    await as.mutation(api.labels.create, { name: "Bug", color: "#eb5757" });
    await expect(
      as.mutation(api.labels.create, { name: "bug", color: "#eb5757" })
    ).rejects.toThrow('A label named "bug" already exists');
    await expect(
      as.mutation(api.labels.create, { name: " ", color: "#eb5757" })
    ).rejects.toThrow("Label name cannot be empty");
    await expect(
      as.mutation(api.labels.create, { name: "Docs", color: "blue" })
    ).rejects.toThrow("Label color must be a hex value");
  });
});

describe("cycles", () => {
  test("rejects overlapping cycles but allows back-to-back ones", async () => {
    const t = convexTest(schema, modules);
    const { as, teamId } = await setupOrg(t, "a");
    const day = 24 * 60 * 60 * 1000;
    await as.mutation(api.cycles.create, {
      teamId,
      startDate: 0,
      endDate: 14 * day,
    });
    await as.mutation(api.cycles.create, {
      teamId,
      startDate: 14 * day,
      endDate: 28 * day,
    });
    await expect(
      as.mutation(api.cycles.create, {
        teamId,
        startDate: 7 * day,
        endDate: 21 * day,
      })
    ).rejects.toThrow("These dates overlap");
  });
});

describe("comments and teams", () => {
  test("caps comment length", async () => {
    const t = convexTest(schema, modules);
    const { as, teamId } = await setupOrg(t, "a");
    const issueId = await as.mutation(api.issues.create, { teamId, title: "x" });
    await expect(
      as.mutation(api.comments.create, { issueId, body: "a".repeat(10_001) })
    ).rejects.toThrow("Comments are limited to 10,000 characters");
  });

  test("rejects empty team names", async () => {
    const t = convexTest(schema, modules);
    const { as } = await setupOrg(t, "a");
    await expect(
      as.mutation(api.teams.create, { name: "  ", key: "OPS" })
    ).rejects.toThrow("Team name cannot be empty");
  });
});
