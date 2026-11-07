import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { isAffirmative } from "./agent/confirm";
import schema from "./schema";
import { modules } from "./test.setup";

type Tester = ReturnType<typeof convexTest>;

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
    await ctx.db.insert("members", { orgId, userId, role: "admin", clerkMembershipId: `mem_${slug}` });
    const teamId = await ctx.db.insert("teams", { orgId, name: "Engineering", key: "ENG", nextIssueNumber: 1 });
    return { userId, orgId, teamId };
  });
  const as = t.withIdentity({ subject: `user_${slug}`, org_id: `org_${slug}` } as never);
  return { ...ids, as };
}

/** A non-admin member in an existing org. */
async function addMember(t: Tester, orgSlug: string, orgId: Id<"organizations">, name: string) {
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", { clerkId: `user_${name}`, name, email: `${name}@example.com` });
    await ctx.db.insert("members", { orgId, userId: id, role: "member", clerkMembershipId: `mem_${name}` });
    return id;
  });
  const as = t.withIdentity({ subject: `user_${name}`, org_id: `org_${orgSlug}` } as never);
  return { userId, as };
}

describe("recycle bin", () => {
  test("deleting an issue moves everything to the bin and restore brings it all back", async () => {
    const t = convexTest(schema, modules);
    const { as, teamId } = await setupOrg(t, "a");
    const parent = await as.mutation(api.issues.create, { teamId, title: "Parent" });
    const child = await as.mutation(api.issues.create, { teamId, title: "Child", parentIssueId: parent });
    const labelId = await as.mutation(api.labels.create, { name: "Bug", color: "#eb5757" });
    await as.mutation(api.labels.toggleOnIssue, { issueId: parent, labelId });
    await as.mutation(api.comments.create, { issueId: parent, body: "keep me" });

    await as.mutation(api.issues.remove, { issueId: parent });

    const bin = await as.query(api.trash.list, {});
    expect(bin.items).toHaveLength(1);
    expect(bin.items[0]).toMatchObject({ kind: "issue", label: "ENG-1 · Parent", deletedByMe: true });
    expect(await t.run((ctx) => ctx.db.get(parent))).toBeNull();

    const restored = await as.mutation(api.trash.restore, { trashId: bin.items[0].trashId });
    expect(restored.kind).toBe("issue");

    const state = await t.run(async (ctx) => {
      const issue = await ctx.db
        .query("issues")
        .withIndex("by_team_and_number", (q) => q.eq("teamId", teamId).eq("number", 1))
        .unique();
      return {
        issue,
        comments: await ctx.db.query("comments").withIndex("by_issue", (q) => q.eq("issueId", issue!._id)).collect(),
        labels: await ctx.db.query("issueLabels").withIndex("by_issue", (q) => q.eq("issueId", issue!._id)).collect(),
        activity: await ctx.db.query("activity").withIndex("by_issue", (q) => q.eq("issueId", issue!._id)).collect(),
        child: await ctx.db.get(child as Id<"issues">),
        trash: await ctx.db.query("trash").collect(),
      };
    });
    expect(state.issue?.title).toBe("Parent");
    expect(state.comments.map((c) => c.body)).toEqual(["keep me"]);
    expect(state.labels).toHaveLength(1);
    expect(state.activity.some((a) => a.type === "restored")).toBe(true);
    expect(state.child?.parentIssueId).toBe(state.issue?._id);
    expect(state.trash).toHaveLength(0);
  });

  test("members only see and restore their own deletions; admins see all; other orgs see nothing", async () => {
    const t = convexTest(schema, modules);
    const admin = await setupOrg(t, "a");
    const member = await addMember(t, "a", admin.orgId, "bob");
    const outsider = await setupOrg(t, "b");

    const adminIssue = await admin.as.mutation(api.issues.create, { teamId: admin.teamId, title: "Admin's" });
    const memberIssue = await member.as.mutation(api.issues.create, { teamId: admin.teamId, title: "Bob's" });
    await admin.as.mutation(api.issues.remove, { issueId: adminIssue });
    await member.as.mutation(api.issues.remove, { issueId: memberIssue });

    const memberView = await member.as.query(api.trash.list, { scope: "all" });
    expect(memberView.scope).toBe("mine");
    expect(memberView.items.map((i) => i.label)).toEqual(["ENG-2 · Bob's"]);

    const adminView = await admin.as.query(api.trash.list, { scope: "all" });
    expect(adminView.items).toHaveLength(2);

    const adminsItem = adminView.items.find((i) => i.label.includes("Admin's"))!;
    await expect(member.as.mutation(api.trash.restore, { trashId: adminsItem.trashId })).rejects.toThrow(
      "Item not found in your recycle bin"
    );
    await expect(outsider.as.mutation(api.trash.restore, { trashId: adminsItem.trashId })).rejects.toThrow(
      "Item not found in your recycle bin"
    );
    expect((await outsider.as.query(api.trash.list, { scope: "all" })).items).toHaveLength(0);

    // Admin can restore a member's deletion.
    const bobsItem = adminView.items.find((i) => i.label.includes("Bob's"))!;
    await admin.as.mutation(api.trash.restore, { trashId: bobsItem.trashId });
  });

  test("project delete detaches issues; restore re-attaches them", async () => {
    const t = convexTest(schema, modules);
    const { as, teamId } = await setupOrg(t, "a");
    const projectId = await as.mutation(api.projects.create, { name: "Launch" });
    const issueId = await as.mutation(api.issues.create, { teamId, title: "Task", projectId });
    await as.mutation(api.projects.remove, { projectId });
    expect((await t.run((ctx) => ctx.db.get(issueId)))?.projectId).toBeUndefined();

    const { items } = await as.query(api.trash.list, {});
    await as.mutation(api.trash.restore, { trashId: items[0].trashId });
    const issue = await t.run((ctx) => ctx.db.get(issueId));
    const project = issue?.projectId ? await t.run((ctx) => ctx.db.get(issue.projectId!)) : null;
    expect(project?.name).toBe("Launch");
  });

  test("expired items are purged; recent ones stay", async () => {
    const t = convexTest(schema, modules);
    const { as, teamId } = await setupOrg(t, "a");
    const a = await as.mutation(api.issues.create, { teamId, title: "Old" });
    const b = await as.mutation(api.issues.create, { teamId, title: "New" });
    await as.mutation(api.issues.remove, { issueId: a });
    await as.mutation(api.issues.remove, { issueId: b });
    await t.run(async (ctx) => {
      const old = (await ctx.db.query("trash").collect()).find((r) => r.label.includes("Old"))!;
      await ctx.db.patch(old._id, { expiresAt: Date.now() - 1 });
    });
    const purged = await t.mutation(internal.trash.purgeExpired, {});
    expect(purged).toBe(1);
    const left = await as.query(api.trash.list, {});
    expect(left.items.map((i) => i.label)).toEqual(["ENG-2 · New"]);
  });
});

describe("templates", () => {
  test("project template creates the project and issues in template order", async () => {
    const t = convexTest(schema, modules);
    const { as, teamId } = await setupOrg(t, "a");
    const result = await as.mutation(api.templates.useProjectTemplate, {
      templateId: "builtin:bug-bash",
      teamId,
    });
    expect(result.projectName).toBe("Bug bash");
    expect(result.identifiers).toEqual(["ENG-1", "ENG-2", "ENG-3", "ENG-4", "ENG-5"]);
    const issues = await t.run((ctx) =>
      ctx.db.query("issues").withIndex("by_project", (q) => q.eq("projectId", result.projectId)).collect()
    );
    const top = [...issues].sort((x, y) => y.sortOrder - x.sortOrder)[0];
    expect(top.number).toBe(1);
  });

  test("workspace template skips existing teams and is admin-only", async () => {
    const t = convexTest(schema, modules);
    const admin = await setupOrg(t, "a");
    const member = await addMember(t, "a", admin.orgId, "bob");
    await expect(
      member.as.mutation(api.templates.useWorkspaceTemplate, { templateId: "builtin:software-team" })
    ).rejects.toThrow();
    const result = await admin.as.mutation(api.templates.useWorkspaceTemplate, {
      templateId: "builtin:software-team",
    });
    expect(result.teamsCreated).toEqual(["Design (DES)", "Product (PRD)"]);
    expect(result.skipped).toContain("team ENG (already exists)");
    expect(result.labelsCreated).toHaveLength(5);
    expect(result.cyclesCreated).toBe(2);
  });

  test("custom templates are org-private and go to the recycle bin", async () => {
    const t = convexTest(schema, modules);
    const a = await setupOrg(t, "a");
    const b = await setupOrg(t, "b");
    const templateId = await a.as.mutation(api.templates.create, {
      kind: "project",
      name: "Sprint kickoff",
      project: { project: {}, issues: [{ title: "Plan sprint" }, { title: "Demo" }] },
    });
    expect((await a.as.query(api.templates.list, { kind: "project" })).some((x) => x.name === "Sprint kickoff")).toBe(true);
    expect((await b.as.query(api.templates.list, { kind: "project" })).some((x) => x.name === "Sprint kickoff")).toBe(false);
    await expect(
      b.as.mutation(api.templates.useProjectTemplate, { templateId, teamId: b.teamId })
    ).rejects.toThrow("Template not found");

    await a.as.mutation(api.templates.remove, { templateId });
    const { items } = await a.as.query(api.trash.list, {});
    expect(items[0].kind).toBe("template");
    await a.as.mutation(api.trash.restore, { trashId: items[0].trashId });
    expect((await a.as.query(api.templates.list, { kind: "project" })).some((x) => x.name === "Sprint kickoff")).toBe(true);
  });
});

describe("agent operations", () => {
  test("sortIssues puts issues in the requested order (first = top)", async () => {
    const t = convexTest(schema, modules);
    const { as, teamId, orgId, userId } = await setupOrg(t, "a");
    for (const title of ["One", "Two", "Three"]) {
      await as.mutation(api.issues.create, { teamId, title });
    }
    await t.mutation(internal.agent.operations.sortIssues, {
      orgId,
      actorUserId: userId,
      identifiers: ["ENG-2", "ENG-3", "ENG-1"],
    });
    const issues = await t.run((ctx) => ctx.db.query("issues").collect());
    const order = [...issues].sort((x, y) => y.sortOrder - x.sortOrder).map((i) => i.title);
    expect(order).toEqual(["Two", "Three", "One"]);
  });

  test("operations reject users who aren't members of the workspace", async () => {
    const t = convexTest(schema, modules);
    const a = await setupOrg(t, "a");
    const b = await setupOrg(t, "b");
    await a.as.mutation(api.issues.create, { teamId: a.teamId, title: "Private" });
    await expect(
      t.mutation(internal.agent.operations.deleteIssue, {
        orgId: a.orgId,
        actorUserId: b.userId,
        identifier: "ENG-1",
      })
    ).rejects.toThrow("Not a member of this workspace");
  });
});

describe("confirmation gate", () => {
  test("recognizes explicit yes and rejects no / hedges", () => {
    for (const yes of ["yes", "Yes please", "ok go ahead", "confirm", "haa", "sure, do it"]) {
      expect(isAffirmative(yes)).toBe(true);
    }
    for (const no of ["no", "don't do that", "yes but wait", "cancel", "maybe later", ""]) {
      expect(isAffirmative(no)).toBe(false);
    }
  });
});
