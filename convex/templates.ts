import { Infer, v } from "convex/values";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import { MutationCtx, QueryCtx } from "./_generated/server";
import { logActivity } from "./lib/activity";
import {
  orgAdminMutation,
  orgMutation,
  orgQuery,
} from "./lib/customFunctions";
import { assertCanCreateIssue, assertCanCreateProject } from "./lib/limits";
import {
  issuePriorityValidator,
  issueStatusValidator,
  projectStatusValidator,
  templateKindValidator,
} from "./schema";
import { trashTemplate } from "./trash";

/**
 * Project & workspace templates.
 *
 * - Project template: a project plus a starter set of issues.
 * - Workspace template: teams, labels and a first cycle for each new team.
 *
 * Built-ins live in code (ids "builtin:<key>"); custom templates are stored
 * per organization in the `templates` table. Everything here is shared by the
 * Templates page (public mutations) and the AI agent (agent/data.ts).
 */

export const projectTemplateContentValidator = v.object({
  project: v.object({
    description: v.optional(v.string()),
    color: v.optional(v.string()),
    status: v.optional(projectStatusValidator),
  }),
  issues: v.array(
    v.object({
      title: v.string(),
      description: v.optional(v.string()),
      priority: v.optional(issuePriorityValidator),
      status: v.optional(issueStatusValidator),
    })
  ),
});

export const workspaceTemplateContentValidator = v.object({
  teams: v.array(
    v.object({
      name: v.string(),
      key: v.string(),
      description: v.optional(v.string()),
    })
  ),
  labels: v.array(v.object({ name: v.string(), color: v.string() })),
  /** Length of the first cycle created for each new team (none if unset). */
  cycleLengthDays: v.optional(v.number()),
});

export type ProjectTemplateContent = Infer<typeof projectTemplateContentValidator>;
export type WorkspaceTemplateContent = Infer<typeof workspaceTemplateContentValidator>;

type ResolvedTemplate =
  | { id: string; source: "builtin" | "custom"; kind: "project"; name: string; description?: string; content: ProjectTemplateContent; creatorId?: Id<"users"> }
  | { id: string; source: "builtin" | "custom"; kind: "workspace"; name: string; description?: string; content: WorkspaceTemplateContent; creatorId?: Id<"users"> };

const BUILTIN_PROJECTS: Record<string, { name: string; description: string; content: ProjectTemplateContent }> = {
  "product-launch": {
    name: "Product launch",
    description: "Plan, build and ship a new feature to customers.",
    content: {
      project: { color: "#8b5cf6", status: "planned", description: "Everything needed to take a feature from spec to launch." },
      issues: [
        { title: "Write the product spec", priority: "high" },
        { title: "Design mockups and get sign-off", priority: "high" },
        { title: "Build the backend API", priority: "medium" },
        { title: "Build the user interface", priority: "medium" },
        { title: "Write automated tests", priority: "medium" },
        { title: "Update docs and help articles", priority: "low" },
        { title: "Prepare launch announcement", priority: "medium" },
        { title: "Launch and monitor metrics", priority: "high" },
      ],
    },
  },
  "website-redesign": {
    name: "Website redesign",
    description: "Refresh the marketing site from audit to go-live.",
    content: {
      project: { color: "#3b82f6", status: "planned" },
      issues: [
        { title: "Audit the current site and analytics", priority: "medium" },
        { title: "Define sitemap and page goals", priority: "high" },
        { title: "Write new page copy", priority: "medium" },
        { title: "Design key page templates", priority: "high" },
        { title: "Build pages and components", priority: "medium" },
        { title: "SEO and redirects check", priority: "medium" },
        { title: "Go live and QA on all devices", priority: "high" },
      ],
    },
  },
  "bug-bash": {
    name: "Bug bash",
    description: "A focused sprint to find and fix bugs before a release.",
    content: {
      project: { color: "#ef4444", status: "planned" },
      issues: [
        { title: "Set the bug bash scope and test accounts", priority: "high" },
        { title: "Run the bug bash session", priority: "high" },
        { title: "Triage and prioritize reported bugs", priority: "urgent" },
        { title: "Fix release-blocking bugs", priority: "urgent" },
        { title: "Verify fixes and close out", priority: "medium" },
      ],
    },
  },
  "customer-onboarding": {
    name: "Customer onboarding",
    description: "Get a new customer set up and successful.",
    content: {
      project: { color: "#10b981", status: "planned" },
      issues: [
        { title: "Kickoff call and goals", priority: "high" },
        { title: "Set up accounts and access", priority: "high" },
        { title: "Import customer data", priority: "medium" },
        { title: "Train the customer's team", priority: "medium" },
        { title: "30-day check-in", priority: "low" },
        { title: "Collect feedback and case study", priority: "low" },
      ],
    },
  },
};

const BUILTIN_WORKSPACES: Record<string, { name: string; description: string; content: WorkspaceTemplateContent }> = {
  "software-team": {
    name: "Software team",
    description: "Engineering, Design and Product teams with standard labels and 2-week cycles.",
    content: {
      teams: [
        { name: "Engineering", key: "ENG" },
        { name: "Design", key: "DES" },
        { name: "Product", key: "PRD" },
      ],
      labels: [
        { name: "Bug", color: "#ef4444" },
        { name: "Feature", color: "#8b5cf6" },
        { name: "Improvement", color: "#3b82f6" },
        { name: "Tech debt", color: "#f59e0b" },
        { name: "Docs", color: "#10b981" },
      ],
      cycleLengthDays: 14,
    },
  },
  startup: {
    name: "Startup",
    description: "A lean Core team and a Growth team with weekly cycles.",
    content: {
      teams: [
        { name: "Core", key: "CORE" },
        { name: "Growth", key: "GROW" },
      ],
      labels: [
        { name: "Bug", color: "#ef4444" },
        { name: "Feature", color: "#8b5cf6" },
        { name: "Customer request", color: "#ec4899" },
        { name: "Marketing", color: "#f59e0b" },
      ],
      cycleLengthDays: 7,
    },
  },
  agency: {
    name: "Agency",
    description: "Client work and internal teams with delivery labels.",
    content: {
      teams: [
        { name: "Client work", key: "CLI" },
        { name: "Internal", key: "INT" },
      ],
      labels: [
        { name: "Design", color: "#8b5cf6" },
        { name: "Development", color: "#3b82f6" },
        { name: "Content", color: "#10b981" },
        { name: "Client review", color: "#f59e0b" },
      ],
      cycleLengthDays: 14,
    },
  },
};

// ── Validation ────────────────────────────────────────────────────────────

const HEX = /^#[0-9a-fA-F]{6}$/;
const TEAM_KEY = /^[A-Z][A-Z0-9]{0,4}$/;

function cleanName(raw: string, what: string, max = 80): string {
  const name = raw.trim();
  if (!name) throw new Error(`${what} cannot be empty`);
  if (name.length > max) throw new Error(`${what} is limited to ${max} characters`);
  return name;
}

export function validateProjectContent(content: ProjectTemplateContent): ProjectTemplateContent {
  if (content.issues.length === 0) throw new Error("A project template needs at least one issue");
  if (content.issues.length > 50) throw new Error("A project template can have at most 50 issues");
  if (content.project.color !== undefined && !HEX.test(content.project.color)) {
    throw new Error("Project color must be a hex color like #5e6ad2");
  }
  return {
    project: content.project,
    issues: content.issues.map((i) => ({ ...i, title: cleanName(i.title, "Issue title", 200) })),
  };
}

export function validateWorkspaceContent(content: WorkspaceTemplateContent): WorkspaceTemplateContent {
  if (content.teams.length === 0 && content.labels.length === 0) {
    throw new Error("A workspace template needs at least one team or label");
  }
  if (content.teams.length > 10) throw new Error("A workspace template can have at most 10 teams");
  if (content.labels.length > 30) throw new Error("A workspace template can have at most 30 labels");
  const keys = new Set<string>();
  const teams = content.teams.map((t) => {
    const key = t.key.trim().toUpperCase();
    if (!TEAM_KEY.test(key)) {
      throw new Error(`Team key "${t.key}" must be 1-5 letters/digits, starting with a letter`);
    }
    if (keys.has(key)) throw new Error(`Team key "${key}" is used twice`);
    keys.add(key);
    return { ...t, key, name: cleanName(t.name, "Team name", 64) };
  });
  const labels = content.labels.map((l) => {
    if (!HEX.test(l.color)) throw new Error(`Label color "${l.color}" must be a hex color like #ef4444`);
    return { name: cleanName(l.name, "Label name", 40), color: l.color };
  });
  const days = content.cycleLengthDays;
  if (days !== undefined && (!Number.isInteger(days) || days < 1 || days > 90)) {
    throw new Error("Cycle length must be a whole number of days between 1 and 90");
  }
  return { teams, labels, cycleLengthDays: days };
}

// ── Resolution & listing ──────────────────────────────────────────────────

export async function resolveTemplate(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"organizations">,
  templateId: string
): Promise<ResolvedTemplate> {
  if (templateId.startsWith("builtin:")) {
    const key = templateId.slice("builtin:".length);
    const project = BUILTIN_PROJECTS[key];
    if (project) return { id: templateId, source: "builtin", kind: "project", ...project };
    const workspace = BUILTIN_WORKSPACES[key];
    if (workspace) return { id: templateId, source: "builtin", kind: "workspace", ...workspace };
    throw new Error("Template not found");
  }
  const id = ctx.db.normalizeId("templates", templateId);
  const doc = id ? await ctx.db.get(id) : null;
  if (!doc || doc.orgId !== orgId) throw new Error("Template not found");
  const base = { id: doc._id as string, source: "custom" as const, name: doc.name, description: doc.description, creatorId: doc.creatorId };
  return doc.kind === "project"
    ? { ...base, kind: "project", content: JSON.parse(doc.content) as ProjectTemplateContent }
    : { ...base, kind: "workspace", content: JSON.parse(doc.content) as WorkspaceTemplateContent };
}

export const templateSummaryValidator = v.object({
  templateId: v.string(),
  source: v.union(v.literal("builtin"), v.literal("custom")),
  kind: templateKindValidator,
  name: v.string(),
  description: v.optional(v.string()),
  /** Issue titles (project) or "Team (KEY)" names (workspace) */
  preview: v.array(v.string()),
  issueCount: v.number(),
  teamCount: v.number(),
  labels: v.array(v.object({ name: v.string(), color: v.string() })),
  cycleLengthDays: v.optional(v.number()),
  color: v.optional(v.string()),
  createdByName: v.optional(v.string()),
  canDelete: v.boolean(),
});
export type TemplateSummary = Infer<typeof templateSummaryValidator>;

function summarize(t: ResolvedTemplate, canDelete: boolean, createdByName?: string): TemplateSummary {
  if (t.kind === "project") {
    return {
      templateId: t.id, source: t.source, kind: t.kind, name: t.name, description: t.description,
      preview: t.content.issues.map((i) => i.title), issueCount: t.content.issues.length,
      teamCount: 0, labels: [], color: t.content.project.color, createdByName, canDelete,
    };
  }
  return {
    templateId: t.id, source: t.source, kind: t.kind, name: t.name, description: t.description,
    preview: t.content.teams.map((team) => `${team.name} (${team.key})`), issueCount: 0,
    teamCount: t.content.teams.length, labels: t.content.labels,
    cycleLengthDays: t.content.cycleLengthDays, createdByName, canDelete,
  };
}

export async function listTemplatesForOrg(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"organizations">,
  userId: Id<"users">,
  isAdmin: boolean,
  kind?: "project" | "workspace"
): Promise<TemplateSummary[]> {
  const builtins: ResolvedTemplate[] = [
    ...Object.entries(BUILTIN_PROJECTS).map(([key, t]) => ({ id: `builtin:${key}`, source: "builtin" as const, kind: "project" as const, ...t })),
    ...Object.entries(BUILTIN_WORKSPACES).map(([key, t]) => ({ id: `builtin:${key}`, source: "builtin" as const, kind: "workspace" as const, ...t })),
  ];
  const customs = await ctx.db
    .query("templates")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  const result: TemplateSummary[] = [];
  for (const doc of customs) {
    const creator = await ctx.db.get(doc.creatorId);
    const resolved = await resolveTemplate(ctx, orgId, doc._id);
    result.push(summarize(resolved, doc.creatorId === userId || isAdmin, creator?.name ?? "Former member"));
  }
  result.push(...builtins.map((t) => summarize(t, false)));
  return kind ? result.filter((t) => t.kind === kind) : result;
}

// ── Apply ─────────────────────────────────────────────────────────────────

/** Insert an issue exactly like issues.create does (number, order, activity). */
async function insertIssue(
  ctx: MutationCtx,
  org: Doc<"organizations">,
  team: Doc<"teams">,
  actorId: Id<"users">,
  fields: { title: string; description?: string; priority?: Doc<"issues">["priority"]; status?: Doc<"issues">["status"]; projectId?: Id<"projects">; sortOrder: number }
): Promise<Id<"issues">> {
  await assertCanCreateIssue(ctx, org);
  const current = (await ctx.db.get(team._id))!;
  const number = current.nextIssueNumber;
  await ctx.db.patch(team._id, { nextIssueNumber: number + 1 });
  const issueId = await ctx.db.insert("issues", {
    orgId: org._id,
    teamId: team._id,
    number,
    title: fields.title,
    description: fields.description,
    status: fields.status ?? "todo",
    priority: fields.priority ?? "none",
    creatorId: actorId,
    projectId: fields.projectId,
    sortOrder: fields.sortOrder,
  });
  await logActivity(ctx, { orgId: org._id, issueId, actorId, type: "created" });
  await ctx.scheduler.runAfter(0, internal.agent.embeddings.embedIssue, { issueId });
  return issueId;
}

export async function applyProjectTemplate(
  ctx: MutationCtx,
  org: Doc<"organizations">,
  actorId: Id<"users">,
  templateId: string,
  team: Doc<"teams">,
  projectName?: string
): Promise<{ projectId: Id<"projects">; projectName: string; identifiers: string[] }> {
  const template = await resolveTemplate(ctx, org._id, templateId);
  if (template.kind !== "project") throw new Error("That is a workspace template, not a project template");
  if (team.orgId !== org._id) throw new Error("Team not found");
  await assertCanCreateProject(ctx, org);

  const name = cleanName(projectName ?? template.name, "Project name");
  const projectId = await ctx.db.insert("projects", {
    orgId: org._id,
    name,
    description: template.content.project.description ?? template.description,
    status: template.content.project.status ?? "planned",
    color: template.content.project.color,
  });

  // First template issue ends up on top (higher sortOrder = higher).
  const newest = await ctx.db
    .query("issues")
    .withIndex("by_team", (q) => q.eq("teamId", team._id))
    .order("desc")
    .first();
  const top = (newest?.sortOrder ?? 0) + 1000 * (template.content.issues.length + 1);
  const identifiers: string[] = [];
  for (const [index, issue] of template.content.issues.entries()) {
    const before = (await ctx.db.get(team._id))!.nextIssueNumber;
    await insertIssue(ctx, org, team, actorId, {
      ...issue,
      projectId,
      sortOrder: top - 1000 * index,
    });
    identifiers.push(`${team.key}-${before}`);
  }
  return { projectId, projectName: name, identifiers };
}

export type WorkspaceApplyResult = {
  teamsCreated: string[];
  labelsCreated: string[];
  cyclesCreated: number;
  skipped: string[];
};

export async function applyWorkspaceTemplate(
  ctx: MutationCtx,
  org: Doc<"organizations">,
  templateId: string
): Promise<WorkspaceApplyResult> {
  const template = await resolveTemplate(ctx, org._id, templateId);
  if (template.kind !== "workspace") throw new Error("That is a project template, not a workspace template");
  return await applyWorkspaceContent(ctx, org, template.content);
}

/** Apply workspace template content directly (used for brand-new workspaces). */
export async function applyWorkspaceContent(
  ctx: MutationCtx,
  org: Doc<"organizations">,
  rawContent: WorkspaceTemplateContent
): Promise<WorkspaceApplyResult> {
  const content = validateWorkspaceContent(rawContent);
  const skipped: string[] = [];
  const teamsCreated: string[] = [];
  let cyclesCreated = 0;

  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  for (const team of content.teams) {
    const existing = await ctx.db
      .query("teams")
      .withIndex("by_org_and_key", (q) => q.eq("orgId", org._id).eq("key", team.key))
      .unique();
    if (existing) {
      skipped.push(`team ${team.key} (already exists)`);
      continue;
    }
    const teamId = await ctx.db.insert("teams", {
      orgId: org._id,
      name: team.name,
      key: team.key,
      description: team.description,
      nextIssueNumber: 1,
    });
    teamsCreated.push(`${team.name} (${team.key})`);
    if (content.cycleLengthDays) {
      await ctx.db.insert("cycles", {
        orgId: org._id,
        teamId,
        number: 1,
        startDate: dayStart.getTime(),
        endDate: dayStart.getTime() + content.cycleLengthDays * 24 * 60 * 60 * 1000,
      });
      cyclesCreated += 1;
    }
  }

  const existingLabels = await ctx.db
    .query("labels")
    .withIndex("by_org", (q) => q.eq("orgId", org._id))
    .collect();
  const names = new Set(existingLabels.map((l) => l.name.toLowerCase()));
  const labelsCreated: string[] = [];
  for (const label of content.labels) {
    if (names.has(label.name.toLowerCase())) {
      skipped.push(`label ${label.name} (already exists)`);
      continue;
    }
    await ctx.db.insert("labels", { orgId: org._id, name: label.name, color: label.color });
    names.add(label.name.toLowerCase());
    labelsCreated.push(label.name);
  }
  return { teamsCreated, labelsCreated, cyclesCreated, skipped };
}

export async function createCustomTemplate(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  actorId: Id<"users">,
  input: {
    kind: "project" | "workspace";
    name: string;
    description?: string;
    project?: ProjectTemplateContent;
    workspace?: WorkspaceTemplateContent;
  }
): Promise<Id<"templates">> {
  const name = cleanName(input.name, "Template name");
  let content: ProjectTemplateContent | WorkspaceTemplateContent;
  if (input.kind === "project") {
    if (!input.project) throw new Error("A project template needs its project and issues");
    content = validateProjectContent(input.project);
  } else {
    if (!input.workspace) throw new Error("A workspace template needs teams and/or labels");
    content = validateWorkspaceContent(input.workspace);
  }
  const existing = await ctx.db
    .query("templates")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .take(201);
  if (existing.length >= 200) throw new Error("This workspace has reached 200 custom templates");
  return await ctx.db.insert("templates", {
    orgId,
    creatorId: actorId,
    kind: input.kind,
    name,
    description: input.description?.trim() || undefined,
    content: JSON.stringify(content),
  });
}

// ── Public API (Templates page) ───────────────────────────────────────────

export const list = orgQuery({
  args: { kind: v.optional(templateKindValidator) },
  returns: v.array(templateSummaryValidator),
  handler: async (ctx, args) => {
    return await listTemplatesForOrg(ctx, ctx.org._id, ctx.user._id, ctx.membership.role === "admin", args.kind);
  },
});

export const create = orgMutation({
  args: {
    kind: templateKindValidator,
    name: v.string(),
    description: v.optional(v.string()),
    project: v.optional(projectTemplateContentValidator),
    workspace: v.optional(workspaceTemplateContentValidator),
  },
  returns: v.id("templates"),
  handler: async (ctx, args) => {
    return await createCustomTemplate(ctx, ctx.org._id, ctx.user._id, args);
  },
});

/** Custom templates only; moves to the recycle bin (creator or admin). */
export const remove = orgMutation({
  args: { templateId: v.id("templates") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const template = await ctx.db.get(args.templateId);
    if (!template || template.orgId !== ctx.org._id) throw new Error("Template not found");
    if (template.creatorId !== ctx.user._id && ctx.membership.role !== "admin") {
      throw new Error("Only the template's creator or an admin can delete it");
    }
    await trashTemplate(ctx, ctx.org._id, ctx.user._id, template);
    return null;
  },
});

export const useProjectTemplate = orgMutation({
  args: {
    templateId: v.string(),
    teamId: v.id("teams"),
    projectName: v.optional(v.string()),
  },
  returns: v.object({
    projectId: v.id("projects"),
    projectName: v.string(),
    identifiers: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const team = await ctx.db.get(args.teamId);
    if (!team || team.orgId !== ctx.org._id) throw new Error("Team not found");
    return await applyProjectTemplate(ctx, ctx.org, ctx.user._id, args.templateId, team, args.projectName);
  },
});

/** Creates teams, so admin-only like teams.create. */
export const useWorkspaceTemplate = orgAdminMutation({
  args: { templateId: v.string() },
  returns: v.object({
    teamsCreated: v.array(v.string()),
    labelsCreated: v.array(v.string()),
    cyclesCreated: v.number(),
    skipped: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    return await applyWorkspaceTemplate(ctx, ctx.org, args.templateId);
  },
});
