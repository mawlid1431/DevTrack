import { v } from "convex/values";
import { internal } from "../_generated/api";
import { Doc, Id } from "../_generated/dataModel";
import {
  MutationCtx,
  QueryCtx,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { logActivity } from "../lib/activity";
import { assertCanCreateProject } from "../lib/limits";
import {
  issuePriorityValidator,
  projectStatusValidator,
  templateKindValidator,
  trashKindValidator,
} from "../schema";
import {
  applyProjectTemplate,
  applyWorkspaceContent,
  applyWorkspaceTemplate,
  createCustomTemplate,
  listTemplatesForOrg,
  projectTemplateContentValidator,
  resolveTemplate,
  templateSummaryValidator,
  workspaceTemplateContentValidator,
} from "../templates";
import { restoreFromTrash, trashIssue, trashProject } from "../trash";
import {
  getOrgTeamByKey,
  issueSummaryValidator,
  resolveMemberByEmail,
  summarizeIssue,
} from "./data";

/**
 * Server-side operations behind the agent's management tools (tools.ts).
 *
 * SECURITY: `orgId` / `actorUserId` always come from the authenticated action
 * context, never from the model. Every function re-checks membership, and
 * admin-only operations check the role. Recycle-bin reads follow the same
 * privacy rule as the UI: members see their own deletions, admins see all.
 */

async function requireMember(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"organizations">,
  userId: Id<"users">
): Promise<{ org: Doc<"organizations">; membership: Doc<"members"> }> {
  const org = await ctx.db.get(orgId);
  const membership = await ctx.db
    .query("members")
    .withIndex("by_org_and_user", (q) => q.eq("orgId", orgId).eq("userId", userId))
    .unique();
  if (!org || !membership) {
    throw new Error("Not a member of this workspace");
  }
  return { org, membership };
}

function parseIdentifier(identifier: string): { teamKey: string; number: number } {
  const match = identifier.trim().match(/^([A-Za-z][A-Za-z0-9]{0,4})-(\d+)$/);
  if (!match) {
    throw new Error(`"${identifier}" is not a valid issue identifier. Use KEY-number, e.g. ENG-42.`);
  }
  return { teamKey: match[1].toUpperCase(), number: Number(match[2]) };
}

async function getIssueByIdentifier(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"organizations">,
  identifier: string
): Promise<{ issue: Doc<"issues">; team: Doc<"teams"> }> {
  const { teamKey, number } = parseIdentifier(identifier);
  const team = await getOrgTeamByKey(ctx, orgId, teamKey);
  const issue = await ctx.db
    .query("issues")
    .withIndex("by_team_and_number", (q) => q.eq("teamId", team._id).eq("number", number))
    .unique();
  if (!issue || issue.orgId !== orgId) {
    throw new Error(`Issue ${team.key}-${number} not found`);
  }
  return { issue, team };
}

async function getProjectByName(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"organizations">,
  name: string
): Promise<Doc<"projects">> {
  const projects = await ctx.db
    .query("projects")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  const wanted = name.trim().toLowerCase();
  const matches = projects.filter((p) => p.name.toLowerCase() === wanted);
  if (matches.length === 0) {
    throw new Error(`No project named "${name}". Use projectStatus to list projects.`);
  }
  if (matches.length > 1) {
    throw new Error(`More than one project is named "${name}"; ask the user which one.`);
  }
  return matches[0];
}

// Previews (read-only, used to describe an action before confirmation)

export const describeIssue = internalQuery({
  args: { orgId: v.id("organizations"), actorUserId: v.id("users"), identifier: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.orgId, args.actorUserId);
    const { issue, team } = await getIssueByIdentifier(ctx, args.orgId, args.identifier);
    const comments = await ctx.db
      .query("comments")
      .withIndex("by_issue", (q) => q.eq("issueId", issue._id))
      .collect();
    return `${team.key}-${issue.number} "${issue.title}" (${issue.status}, ${comments.length} comment${comments.length === 1 ? "" : "s"})`;
  },
});

export const describeProject = internalQuery({
  args: { orgId: v.id("organizations"), actorUserId: v.id("users"), name: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.orgId, args.actorUserId);
    const project = await getProjectByName(ctx, args.orgId, args.name);
    const issues = await ctx.db
      .query("issues")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .collect();
    return `project "${project.name}" (${issues.length} issue${issues.length === 1 ? "" : "s"} will be detached, not deleted)`;
  },
});

export const describeTemplate = internalQuery({
  args: { orgId: v.id("organizations"), actorUserId: v.id("users"), templateId: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.orgId, args.actorUserId);
    const t = await resolveTemplate(ctx, args.orgId, args.templateId);
    return t.kind === "project"
      ? `project template "${t.name}" with ${t.content.issues.length} issues: ${t.content.issues.map((i) => i.title).join("; ")}`
      : `workspace template "${t.name}": teams ${t.content.teams.map((x) => `${x.name} (${x.key})`).join(", ") || "none"}; labels ${t.content.labels.map((l) => l.name).join(", ") || "none"}${t.content.cycleLengthDays ? `; first ${t.content.cycleLengthDays}-day cycle per new team` : ""}`;
  },
});

// Issues: delete, my issues, prioritize, sort

export const deleteIssue = internalMutation({
  args: { orgId: v.id("organizations"), actorUserId: v.id("users"), identifier: v.string() },
  returns: v.object({ trashId: v.id("trash"), identifier: v.string() }),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.orgId, args.actorUserId);
    const { issue, team } = await getIssueByIdentifier(ctx, args.orgId, args.identifier);
    const trashId = await trashIssue(ctx, args.orgId, args.actorUserId, issue);
    return { trashId, identifier: `${team.key}-${issue.number}` };
  },
});

const PRIORITY_RANK: Record<Doc<"issues">["priority"], number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};

export const listMyIssues = internalQuery({
  args: {
    orgId: v.id("organizations"),
    actorUserId: v.id("users"),
    includeDone: v.optional(v.boolean()),
  },
  returns: v.array(issueSummaryValidator),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.orgId, args.actorUserId);
    const issues = await ctx.db
      .query("issues")
      .withIndex("by_assignee", (q) => q.eq("orgId", args.orgId).eq("assigneeId", args.actorUserId))
      .collect();
    const open = issues.filter(
      (i) => args.includeDone || (i.status !== "done" && i.status !== "canceled")
    );
    // Current display order: priority first, then the user's manual order.
    open.sort(
      (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || b.sortOrder - a.sortOrder
    );
    const keys = new Map<Id<"teams">, string>();
    const out = [];
    for (const issue of open.slice(0, 100)) {
      out.push(await summarizeIssue(ctx, issue, keys));
    }
    return out;
  },
});

export const prioritizeIssues = internalMutation({
  args: {
    orgId: v.id("organizations"),
    actorUserId: v.id("users"),
    updates: v.array(v.object({ identifier: v.string(), priority: issuePriorityValidator })),
  },
  returns: v.array(v.object({ identifier: v.string(), from: v.string(), to: v.string() })),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.orgId, args.actorUserId);
    if (args.updates.length > 100) throw new Error("At most 100 issues per request");
    const changed = [];
    for (const update of args.updates) {
      const { issue, team } = await getIssueByIdentifier(ctx, args.orgId, update.identifier);
      if (issue.priority === update.priority) continue;
      await ctx.db.patch(issue._id, { priority: update.priority });
      await logActivity(ctx, {
        orgId: args.orgId,
        issueId: issue._id,
        actorId: args.actorUserId,
        type: "priority_changed",
        field: "priority",
        oldValue: issue.priority,
        newValue: update.priority,
      });
      changed.push({ identifier: `${team.key}-${issue.number}`, from: issue.priority, to: update.priority });
    }
    return changed;
  },
});

/**
 * Put issues in exactly this order (first = top) on lists and boards.
 * Higher sortOrder = higher in the column, so the given order gets
 * descending sortOrders above everything currently in those teams.
 */
export const sortIssues = internalMutation({
  args: {
    orgId: v.id("organizations"),
    actorUserId: v.id("users"),
    identifiers: v.array(v.string()),
  },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.orgId, args.actorUserId);
    if (args.identifiers.length > 200) throw new Error("At most 200 issues per request");
    const found = [];
    for (const identifier of args.identifiers) {
      found.push(await getIssueByIdentifier(ctx, args.orgId, identifier));
    }
    let top = 0;
    for (const teamId of new Set(found.map((f) => f.team._id))) {
      const highest = await ctx.db
        .query("issues")
        .withIndex("by_team", (q) => q.eq("teamId", teamId))
        .collect();
      top = Math.max(top, ...highest.map((i) => i.sortOrder));
    }
    const ordered: string[] = [];
    for (const [index, { issue, team }] of found.entries()) {
      await ctx.db.patch(issue._id, { sortOrder: top + 1000 * (found.length - index) });
      ordered.push(`${team.key}-${issue.number}`);
    }
    return ordered;
  },
});

// Projects

export const createProject = internalMutation({
  args: {
    orgId: v.id("organizations"),
    actorUserId: v.id("users"),
    name: v.string(),
    description: v.optional(v.string()),
    status: v.optional(projectStatusValidator),
    leadEmail: v.optional(v.string()),
  },
  returns: v.object({ projectId: v.id("projects"), name: v.string() }),
  handler: async (ctx, args) => {
    const { org } = await requireMember(ctx, args.orgId, args.actorUserId);
    await assertCanCreateProject(ctx, org);
    const name = args.name.trim();
    if (!name) throw new Error("Project name cannot be empty");
    if (name.length > 80) throw new Error("Project names are limited to 80 characters");
    const lead = args.leadEmail ? await resolveMemberByEmail(ctx, args.orgId, args.leadEmail) : undefined;
    const projectId = await ctx.db.insert("projects", {
      orgId: args.orgId,
      name,
      description: args.description,
      status: args.status ?? "planned",
      leadId: lead?._id,
    });
    return { projectId, name };
  },
});

export const deleteProject = internalMutation({
  args: { orgId: v.id("organizations"), actorUserId: v.id("users"), name: v.string() },
  returns: v.object({ trashId: v.id("trash"), name: v.string() }),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.orgId, args.actorUserId);
    const project = await getProjectByName(ctx, args.orgId, args.name);
    const trashId = await trashProject(ctx, args.orgId, args.actorUserId, project);
    return { trashId, name: project.name };
  },
});

// Templates

export const listTemplates = internalQuery({
  args: { orgId: v.id("organizations"), actorUserId: v.id("users"), kind: v.optional(templateKindValidator) },
  returns: v.array(templateSummaryValidator),
  handler: async (ctx, args) => {
    const { membership } = await requireMember(ctx, args.orgId, args.actorUserId);
    return await listTemplatesForOrg(ctx, args.orgId, args.actorUserId, membership.role === "admin", args.kind);
  },
});

export const getWorkspaceTemplateContent = internalQuery({
  args: { orgId: v.id("organizations"), actorUserId: v.id("users"), templateId: v.string() },
  returns: workspaceTemplateContentValidator,
  handler: async (ctx, args) => {
    await requireMember(ctx, args.orgId, args.actorUserId);
    const t = await resolveTemplate(ctx, args.orgId, args.templateId);
    if (t.kind !== "workspace") throw new Error("That is a project template, not a workspace template");
    return t.content;
  },
});

export const createProjectFromTemplate = internalMutation({
  args: {
    orgId: v.id("organizations"),
    actorUserId: v.id("users"),
    templateId: v.string(),
    teamKey: v.string(),
    projectName: v.optional(v.string()),
  },
  returns: v.object({ projectId: v.id("projects"), projectName: v.string(), identifiers: v.array(v.string()) }),
  handler: async (ctx, args) => {
    const { org } = await requireMember(ctx, args.orgId, args.actorUserId);
    const team = await getOrgTeamByKey(ctx, args.orgId, args.teamKey);
    return await applyProjectTemplate(ctx, org, args.actorUserId, args.templateId, team, args.projectName);
  },
});

export const createTemplate = internalMutation({
  args: {
    orgId: v.id("organizations"),
    actorUserId: v.id("users"),
    kind: templateKindValidator,
    name: v.string(),
    description: v.optional(v.string()),
    project: v.optional(projectTemplateContentValidator),
    workspace: v.optional(workspaceTemplateContentValidator),
  },
  returns: v.object({ templateId: v.id("templates"), name: v.string() }),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.orgId, args.actorUserId);
    const { orgId, actorUserId, ...input } = args;
    const templateId = await createCustomTemplate(ctx, orgId, actorUserId, input);
    return { templateId, name: input.name.trim() };
  },
});

export const applyWorkspaceTemplateToCurrent = internalMutation({
  args: { orgId: v.id("organizations"), actorUserId: v.id("users"), templateId: v.string() },
  returns: v.object({
    teamsCreated: v.array(v.string()),
    labelsCreated: v.array(v.string()),
    cyclesCreated: v.number(),
    skipped: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const { org, membership } = await requireMember(ctx, args.orgId, args.actorUserId);
    if (membership.role !== "admin") {
      throw new Error("Only workspace admins can apply a workspace template (it creates teams)");
    }
    return await applyWorkspaceTemplate(ctx, org, args.templateId);
  },
});

// New workspace (Clerk organization)

export const clerkUserForActor = internalQuery({
  args: { orgId: v.id("organizations"), actorUserId: v.id("users") },
  returns: v.object({ clerkUserId: v.string(), name: v.string() }),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.orgId, args.actorUserId);
    const user = await ctx.db.get(args.actorUserId);
    if (!user) throw new Error("User not found");
    return { clerkUserId: user.clerkId, name: user.name };
  },
});

/**
 * A new Clerk organization reaches Convex via webhook a moment after it is
 * created. Retry until it (and the creator's membership) has synced, then
 * apply the workspace template content.
 */
export const applyTemplateToNewWorkspace = internalMutation({
  args: {
    clerkOrgId: v.string(),
    actorUserId: v.id("users"),
    content: workspaceTemplateContentValidator,
    attempt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const org = await ctx.db
      .query("organizations")
      .withIndex("by_clerk_org_id", (q) => q.eq("clerkOrgId", args.clerkOrgId))
      .unique();
    const membership = org
      ? await ctx.db
          .query("members")
          .withIndex("by_org_and_user", (q) => q.eq("orgId", org._id).eq("userId", args.actorUserId))
          .unique()
      : null;
    if (!org || !membership) {
      if (args.attempt < 12) {
        await ctx.scheduler.runAfter(5_000, internal.agent.operations.applyTemplateToNewWorkspace, {
          ...args,
          attempt: args.attempt + 1,
        });
      } else {
        console.error(`New workspace ${args.clerkOrgId} never synced; template not applied`);
      }
      return null;
    }
    await applyWorkspaceContent(ctx, org, args.content);
    return null;
  },
});

// Recycle bin

export const listRecycleBin = internalQuery({
  args: { orgId: v.id("organizations"), actorUserId: v.id("users") },
  returns: v.array(
    v.object({
      trashId: v.id("trash"),
      kind: trashKindValidator,
      label: v.string(),
      deletedByName: v.string(),
      deletedAt: v.string(),
      daysLeft: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const { membership } = await requireMember(ctx, args.orgId, args.actorUserId);
    const rows =
      membership.role === "admin"
        ? await ctx.db
            .query("trash")
            .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
            .order("desc")
            .take(50)
        : await ctx.db
            .query("trash")
            .withIndex("by_org_and_deleter", (q) =>
              q.eq("orgId", args.orgId).eq("deletedBy", args.actorUserId)
            )
            .order("desc")
            .take(50);
    const out = [];
    for (const row of rows) {
      const user = await ctx.db.get(row.deletedBy);
      out.push({
        trashId: row._id,
        kind: row.kind,
        label: row.label,
        deletedByName: user?.name ?? "Former member",
        deletedAt: new Date(row.deletedAt).toISOString().slice(0, 16).replace("T", " "),
        daysLeft: Math.max(0, Math.ceil((row.expiresAt - Date.now()) / 86_400_000)),
      });
    }
    return out;
  },
});

export const restoreItem = internalMutation({
  args: { orgId: v.id("organizations"), actorUserId: v.id("users"), trashId: v.string() },
  returns: v.object({ kind: trashKindValidator, label: v.string(), path: v.union(v.string(), v.null()) }),
  handler: async (ctx, args) => {
    const { org, membership } = await requireMember(ctx, args.orgId, args.actorUserId);
    const trashId = ctx.db.normalizeId("trash", args.trashId);
    if (!trashId) throw new Error("Item not found in your recycle bin");
    const result = await restoreFromTrash(ctx, org, args.actorUserId, membership.role, trashId);
    // Give the agent a link that opens directly in this workspace.
    return { ...result, path: result.path ? `/${org.slug}${result.path}` : null };
  },
});

// Screen navigation (navigateTo tool)

export const NAV_PAGES = [
  "home",
  "projects",
  "cycles",
  "ai",
  "templates",
  "trash",
  "search",
  "settings",
  "members",
  "billing",
  "issue",
  "project",
  "team",
  "teamBoard",
] as const;
export type NavPage = (typeof NAV_PAGES)[number];

/**
 * Resolve a page (+ optional human reference like "ENG-42", a team key or a
 * project name) to a workspace-relative path. The client prefixes the org
 * slug, so the agent can only ever move the user within their own workspace.
 */
export const resolveNavigation = internalQuery({
  args: {
    orgId: v.id("organizations"),
    actorUserId: v.id("users"),
    page: v.string(),
    ref: v.optional(v.string()),
  },
  returns: v.object({ path: v.string(), label: v.string() }),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.orgId, args.actorUserId);
    const ref = args.ref?.trim();
    const needRef = (what: string): string => {
      if (!ref) throw new Error(`Pass ref with the ${what} to open this page.`);
      return ref;
    };
    switch (args.page as NavPage) {
      case "home":
        return { path: "", label: "Workspace home" };
      case "projects":
      case "cycles":
      case "ai":
      case "templates":
      case "trash":
      case "search":
      case "settings":
        return { path: `/${args.page}`, label: args.page };
      case "members":
        return { path: "/settings/members", label: "Members" };
      case "billing":
        return { path: "/settings/billing", label: "Billing" };
      case "issue": {
        const { issue, team } = await getIssueByIdentifier(ctx, args.orgId, needRef("issue identifier, e.g. ENG-42"));
        return { path: `/issue/${issue._id}`, label: `${team.key}-${issue.number}` };
      }
      case "project": {
        const project = await getProjectByName(ctx, args.orgId, needRef("project name"));
        return { path: `/projects/${project._id}`, label: project.name };
      }
      case "team":
      case "teamBoard": {
        const team = await getOrgTeamByKey(ctx, args.orgId, needRef("team key, e.g. ENG").toUpperCase());
        return {
          path: `/team/${team._id}${args.page === "teamBoard" ? "/board" : ""}`,
          label: `${team.name}${args.page === "teamBoard" ? " board" : ""}`,
        };
      }
      default:
        throw new Error(`Unknown page "${args.page}". Use one of: ${NAV_PAGES.join(", ")}.`);
    }
  },
});

/** Create a team (admins only, same rules as the UI's create-team dialog). */
export const createTeam = internalMutation({
  args: {
    orgId: v.id("organizations"),
    actorUserId: v.id("users"),
    name: v.string(),
    key: v.string(),
    description: v.optional(v.string()),
  },
  returns: v.object({ teamId: v.id("teams"), name: v.string(), key: v.string() }),
  handler: async (ctx, args) => {
    const { membership } = await requireMember(ctx, args.orgId, args.actorUserId);
    if (membership.role !== "admin") {
      throw new Error("Only workspace admins can create teams");
    }
    const name = args.name.trim();
    if (!name || name.length > 64) {
      throw new Error("Team name must be 1-64 characters");
    }
    const key = args.key.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9]{0,4}$/.test(key)) {
      throw new Error("Team key must be 1-5 letters or digits, starting with a letter");
    }
    const existing = await ctx.db
      .query("teams")
      .withIndex("by_org_and_key", (q) => q.eq("orgId", args.orgId).eq("key", key))
      .unique();
    if (existing) {
      throw new Error(`Team key "${key}" is already in use`);
    }
    const teamId = await ctx.db.insert("teams", {
      orgId: args.orgId,
      name,
      key,
      description: args.description,
      nextIssueNumber: 1,
    });
    return { teamId, name, key };
  },
});
