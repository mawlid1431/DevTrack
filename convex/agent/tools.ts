import { createTool, type ToolCtx } from "@convex-dev/agent";
import { jsonSchema } from "ai";
import { Infer } from "convex/values";
import { internal } from "../_generated/api";
import { DataModel, Id } from "../_generated/dataModel";
import { issueSummaryValidator } from "./data";
import { NeedsConfirmation, requireConfirmation } from "./confirm";
import { embedText } from "./embeddings";

/**
 * Org-scoped tools for the DevTrack agent.
 *
 * SECURITY: every tool reads `orgId` / `requestUserId` from the custom action
 * context that our own internal action injects after authenticating the
 * caller. The model can never choose which org it operates on, tool inputs
 * only carry user-meaningful identifiers (team keys, issue numbers, emails)
 * that are resolved inside the caller's org.
 *
 * NOTE: `execute` return types are annotated explicitly to avoid a type cycle
 * through `internal` → `_generated/api` → this module.
 */
export type DevTrackToolCtx = ToolCtx<DataModel> & {
  orgId: Id<"organizations">;
  requestUserId: Id<"users">;
};

type IssueSummary = Infer<typeof issueSummaryValidator>;

const ISSUE_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "canceled",
] as const;
const ISSUE_PRIORITIES = ["none", "urgent", "high", "medium", "low"] as const;

type IssueStatus = (typeof ISSUE_STATUSES)[number];
type IssuePriority = (typeof ISSUE_PRIORITIES)[number];

const emptyInput = jsonSchema<Record<string, never>>({
  type: "object",
  properties: {},
  additionalProperties: false,
});

const listTeams = createTool({
  description:
    "List the teams in this workspace with their issue-prefix keys (e.g. ENG). Use a team key whenever another tool needs one.",
  inputSchema: emptyInput,
  execute: async (
    ctx: DevTrackToolCtx
  ): Promise<
    Array<{ teamId: Id<"teams">; name: string; key: string; issueCount: number }>
  > => {
    return await ctx.runQuery(internal.agent.data.listTeamsForOrg, {
      orgId: ctx.orgId,
    });
  },
});

const listMembers = createTool({
  description:
    "List the members of this workspace with their names, emails and roles. Use emails when assigning issues.",
  inputSchema: emptyInput,
  execute: async (
    ctx: DevTrackToolCtx
  ): Promise<Array<{ name: string; email: string; role: string }>> => {
    return await ctx.runQuery(internal.agent.data.listMembersForOrg, {
      orgId: ctx.orgId,
    });
  },
});

const projectStatus = createTool({
  description:
    "Get the status of every project in the workspace: progress counts, lead and target date.",
  inputSchema: emptyInput,
  execute: async (
    ctx: DevTrackToolCtx
  ): Promise<
    Array<{
      name: string;
      status: string;
      leadName: string | null;
      targetDate: string | null;
      totalIssues: number;
      doneIssues: number;
      inProgressIssues: number;
    }>
  > => {
    return await ctx.runQuery(internal.agent.data.listProjectStatus, {
      orgId: ctx.orgId,
    });
  },
});

const searchIssues = createTool({
  description:
    "Full-text search issues by title in this workspace. Optionally restrict to one team by key.",
  inputSchema: jsonSchema<{ query: string; teamKey?: string }>({
    type: "object",
    properties: {
      query: { type: "string", description: "Search terms for issue titles" },
      teamKey: {
        type: "string",
        description: "Optional team key, e.g. ENG, to limit the search",
      },
    },
    required: ["query"],
    additionalProperties: false,
  }),
  execute: async (ctx: DevTrackToolCtx, input): Promise<IssueSummary[]> => {
    return await ctx.runQuery(internal.agent.data.searchIssues, {
      orgId: ctx.orgId,
      query: input.query,
      teamKey: input.teamKey,
    });
  },
});

const findSimilarIssues = createTool({
  description:
    "Semantic search: find issues whose meaning is similar to the given text. Best for detecting duplicates before creating a new issue.",
  inputSchema: jsonSchema<{ text: string }>({
    type: "object",
    properties: {
      text: {
        type: "string",
        description:
          "Issue title and/or description to find semantically similar issues for",
      },
    },
    required: ["text"],
    additionalProperties: false,
  }),
  execute: async (
    ctx: DevTrackToolCtx,
    input
  ): Promise<Array<IssueSummary & { similarity: number }>> => {
    const embedding = await embedText(input.text);
    const results = await ctx.vectorSearch("issues", "by_embedding", {
      vector: embedding,
      limit: 8,
      filter: (q) => q.eq("orgId", ctx.orgId),
    });
    const summaries: IssueSummary[] = await ctx.runQuery(
      internal.agent.data.issueSummariesByIds,
      { orgId: ctx.orgId, issueIds: results.map((r) => r._id) }
    );
    const scores = new Map(results.map((r) => [r._id, r._score]));
    return summaries
      .map((summary) => ({
        ...summary,
        similarity: Math.round((scores.get(summary.issueId) ?? 0) * 100) / 100,
      }))
      .filter((summary) => summary.similarity >= 0.35);
  },
});

const createIssue = createTool({
  description:
    "Create a new issue in a team. Runs immediately. Check for duplicates with findSimilarIssues first when it makes sense.",
  inputSchema: jsonSchema<{
    teamKey: string;
    title: string;
    description?: string;
    status?: IssueStatus;
    priority?: IssuePriority;
    assigneeEmail?: string;
    confirmationCode?: string;
  }>({
    type: "object",
    properties: {
      teamKey: { type: "string", description: "Team key, e.g. ENG" },
      title: { type: "string", description: "Short, specific issue title" },
      description: {
        type: "string",
        description: "Optional longer description in plain text",
      },
      status: {
        type: "string",
        enum: [...ISSUE_STATUSES],
        description: "Initial status (defaults to todo)",
      },
      priority: {
        type: "string",
        enum: [...ISSUE_PRIORITIES],
        description: "Priority (defaults to none)",
      },
      assigneeEmail: {
        type: "string",
        description: "Email of the workspace member to assign",
      },
      confirmationCode: {
        type: "string",
        description:
          "Leave out. Only used if this action ever returns needs_confirmation.",
      },
    },
    required: ["teamKey", "title"],
    additionalProperties: false,
  }),
  execute: async (
    ctx: DevTrackToolCtx,
    input
  ): Promise<
    | NeedsConfirmation
    | { status: "done"; issueId: Id<"issues">; identifier: string }
  > => {
    const { confirmationCode, ...args } = input;
    const pending = await requireConfirmation(
      ctx,
      "createIssue",
      args,
      `Create issue "${args.title}" in team ${args.teamKey.toUpperCase()} (status ${args.status ?? "todo"}, priority ${args.priority ?? "none"}${args.assigneeEmail ? `, assigned to ${args.assigneeEmail}` : ""}).`,
      confirmationCode
    );
    if (pending) return pending;
    const result = await ctx.runMutation(internal.agent.data.createIssueForAgent, {
      orgId: ctx.orgId,
      actorUserId: ctx.requestUserId,
      teamKey: args.teamKey,
      title: args.title,
      description: args.description,
      status: args.status,
      priority: args.priority,
      assigneeEmail: args.assigneeEmail,
    });
    return { status: "done", ...result };
  },
});

const updateIssue = createTool({
  description:
    "Update an existing issue referenced by its identifier (e.g. ENG-42). Only pass the fields you want to change. Pass assigneeEmail: null to unassign.",
  inputSchema: jsonSchema<{
    identifier: string;
    title?: string;
    description?: string;
    status?: IssueStatus;
    priority?: IssuePriority;
    assigneeEmail?: string | null;
  }>({
    type: "object",
    properties: {
      identifier: {
        type: "string",
        description: "Issue identifier like ENG-42",
      },
      title: { type: "string" },
      description: { type: "string" },
      status: { type: "string", enum: [...ISSUE_STATUSES] },
      priority: { type: "string", enum: [...ISSUE_PRIORITIES] },
      assigneeEmail: {
        type: ["string", "null"],
        description: "Member email to assign, or null to unassign",
      },
    },
    required: ["identifier"],
    additionalProperties: false,
  }),
  execute: async (
    ctx: DevTrackToolCtx,
    input
  ): Promise<{ identifier: string; changedFields: string[] }> => {
    const match = input.identifier
      .trim()
      .match(/^([A-Za-z][A-Za-z0-9]{0,4})-(\d+)$/);
    if (!match) {
      throw new Error(
        `"${input.identifier}" is not a valid issue identifier. Use the form KEY-number, e.g. ENG-42.`
      );
    }
    return await ctx.runMutation(internal.agent.data.updateIssueForAgent, {
      orgId: ctx.orgId,
      actorUserId: ctx.requestUserId,
      teamKey: match[1],
      number: Number(match[2]),
      title: input.title,
      description: input.description,
      status: input.status,
      priority: input.priority,
      assigneeEmail: input.assigneeEmail,
    });
  },
});

type CycleSummary = {
  teamName: string;
  teamKey: string;
  cycle: {
    name: string;
    startDate: string;
    endDate: string;
    daysRemaining: number;
  } | null;
  counts: {
    total: number;
    done: number;
    inProgress: number;
    inReview: number;
    todo: number;
    backlog: number;
    canceled: number;
  };
  issues: IssueSummary[];
};

const cycleSummary = createTool({
  description:
    "Summarize a team's current cycle (sprint): dates, days remaining, progress counts and the issues in it.",
  inputSchema: jsonSchema<{ teamKey: string }>({
    type: "object",
    properties: {
      teamKey: { type: "string", description: "Team key, e.g. ENG" },
    },
    required: ["teamKey"],
    additionalProperties: false,
  }),
  execute: async (ctx: DevTrackToolCtx, input): Promise<CycleSummary> => {
    return await ctx.runQuery(internal.agent.data.cycleSummaryForTeam, {
      orgId: ctx.orgId,
      teamKey: input.teamKey,
    });
  },
});

type StandupData = {
  sinceHours: number;
  entries: Array<{
    memberName: string;
    inProgress: IssueSummary[];
    completed: IssueSummary[];
    created: IssueSummary[];
  }>;
};

const standupReport = createTool({
  description:
    "Gather standup data: what each member completed and created recently, plus what they have in progress. Optionally restrict to a team.",
  inputSchema: jsonSchema<{ teamKey?: string; sinceHours?: number }>({
    type: "object",
    properties: {
      teamKey: {
        type: "string",
        description: "Optional team key to restrict the report to",
      },
      sinceHours: {
        type: "number",
        description: "Look-back window in hours (default 24, max 168)",
      },
    },
    additionalProperties: false,
  }),
  execute: async (ctx: DevTrackToolCtx, input): Promise<StandupData> => {
    const sinceHours = Math.min(Math.max(input.sinceHours ?? 24, 1), 168);
    return await ctx.runQuery(internal.agent.data.standupForOrg, {
      orgId: ctx.orgId,
      teamKey: input.teamKey,
      sinceHours,
    });
  },
});

// Management tools (only workspace-wide actions are confirmation-gated)

const confirmationCodeProp = {
  confirmationCode: {
    type: "string",
    description:
      "Leave out. Only used if this action ever returns needs_confirmation.",
  },
} as const;

type Gated<T> = T & { confirmationCode?: string };
type GateResult<T> = NeedsConfirmation | ({ status: "done" } & T);

function withoutCode<T extends { confirmationCode?: string }>(input: T): Omit<T, "confirmationCode"> {
  const { confirmationCode, ...rest } = input;
  void confirmationCode;
  return rest;
}

const deleteIssue = createTool({
  description:
    "Move an issue (with its comments and attachments) to the recycle bin. Restorable for 30 days. Runs immediately.",
  inputSchema: jsonSchema<Gated<{ identifier: string }>>({
    type: "object",
    properties: {
      identifier: { type: "string", description: "Issue identifier like ENG-42" },
      ...confirmationCodeProp,
    },
    required: ["identifier"],
    additionalProperties: false,
  }),
  execute: async (
    ctx: DevTrackToolCtx,
    input
  ): Promise<GateResult<{ identifier: string; note: string }>> => {
    const args = withoutCode(input);
    const what = await ctx.runQuery(internal.agent.operations.describeIssue, {
      orgId: ctx.orgId,
      actorUserId: ctx.requestUserId,
      identifier: args.identifier,
    });
    const pending = await requireConfirmation(
      ctx,
      "deleteIssue",
      args,
      `Move ${what} to the recycle bin (restorable for 30 days).`,
      input.confirmationCode
    );
    if (pending) return pending;
    const result = await ctx.runMutation(internal.agent.operations.deleteIssue, {
      orgId: ctx.orgId,
      actorUserId: ctx.requestUserId,
      identifier: args.identifier,
    });
    return {
      status: "done",
      identifier: result.identifier,
      note: "Moved to the recycle bin; it can be restored for 30 days.",
    };
  },
});

const listMyIssues = createTool({
  description:
    "List the open issues assigned to the requesting user, in their current order (priority first, then manual order). Use before prioritizing or sorting 'my tasks'.",
  inputSchema: jsonSchema<{ includeDone?: boolean }>({
    type: "object",
    properties: {
      includeDone: { type: "boolean", description: "Also include done/canceled issues" },
    },
    additionalProperties: false,
  }),
  execute: async (ctx: DevTrackToolCtx, input): Promise<IssueSummary[]> => {
    return await ctx.runQuery(internal.agent.operations.listMyIssues, {
      orgId: ctx.orgId,
      actorUserId: ctx.requestUserId,
      includeDone: input.includeDone,
    });
  },
});

const prioritizeIssues = createTool({
  description:
    "Set the priority of one or more issues in one go (e.g. when the user asks to prioritize their tasks). Small edit: no confirmation needed. Report what changed.",
  inputSchema: jsonSchema<{
    updates: Array<{ identifier: string; priority: IssuePriority }>;
  }>({
    type: "object",
    properties: {
      updates: {
        type: "array",
        items: {
          type: "object",
          properties: {
            identifier: { type: "string", description: "Issue identifier like ENG-42" },
            priority: { type: "string", enum: [...ISSUE_PRIORITIES] },
          },
          required: ["identifier", "priority"],
          additionalProperties: false,
        },
      },
    },
    required: ["updates"],
    additionalProperties: false,
  }),
  execute: async (
    ctx: DevTrackToolCtx,
    input
  ): Promise<Array<{ identifier: string; from: string; to: string }>> => {
    return await ctx.runMutation(internal.agent.operations.prioritizeIssues, {
      orgId: ctx.orgId,
      actorUserId: ctx.requestUserId,
      updates: input.updates,
    });
  },
});

const sortIssues = createTool({
  description:
    "Reorder issues on lists and boards: pass identifiers in the exact order the user wants (first = top). Small edit: no confirmation needed.",
  inputSchema: jsonSchema<{ identifiers: string[] }>({
    type: "object",
    properties: {
      identifiers: {
        type: "array",
        items: { type: "string" },
        description: "Issue identifiers in the desired order, top first",
      },
    },
    required: ["identifiers"],
    additionalProperties: false,
  }),
  execute: async (ctx: DevTrackToolCtx, input): Promise<{ order: string[] }> => {
    const order = await ctx.runMutation(internal.agent.operations.sortIssues, {
      orgId: ctx.orgId,
      actorUserId: ctx.requestUserId,
      identifiers: input.identifiers,
    });
    return { order };
  },
});

const createProject = createTool({
  description:
    "Create an empty project. Runs immediately. To create a project with starter issues, use createProjectFromTemplate instead.",
  inputSchema: jsonSchema<
    Gated<{
      name: string;
      description?: string;
      status?: "backlog" | "planned" | "in_progress" | "paused" | "completed" | "canceled";
      leadEmail?: string;
    }>
  >({
    type: "object",
    properties: {
      name: { type: "string" },
      description: { type: "string" },
      status: {
        type: "string",
        enum: ["backlog", "planned", "in_progress", "paused", "completed", "canceled"],
      },
      leadEmail: { type: "string", description: "Email of the member who leads it" },
      ...confirmationCodeProp,
    },
    required: ["name"],
    additionalProperties: false,
  }),
  execute: async (
    ctx: DevTrackToolCtx,
    input
  ): Promise<GateResult<{ projectName: string }>> => {
    const args = withoutCode(input);
    const pending = await requireConfirmation(
      ctx,
      "createProject",
      args,
      `Create project "${args.name}"${args.leadEmail ? ` led by ${args.leadEmail}` : ""} with status ${args.status ?? "planned"}.`,
      input.confirmationCode
    );
    if (pending) return pending;
    const result = await ctx.runMutation(internal.agent.operations.createProject, {
      orgId: ctx.orgId,
      actorUserId: ctx.requestUserId,
      ...args,
    });
    return { status: "done", projectName: result.name };
  },
});

const deleteProject = createTool({
  description:
    "Move a project to the recycle bin (its issues are kept, just detached). Runs immediately.",
  inputSchema: jsonSchema<Gated<{ name: string }>>({
    type: "object",
    properties: {
      name: { type: "string", description: "Exact project name" },
      ...confirmationCodeProp,
    },
    required: ["name"],
    additionalProperties: false,
  }),
  execute: async (ctx: DevTrackToolCtx, input): Promise<GateResult<{ name: string }>> => {
    const args = withoutCode(input);
    const what = await ctx.runQuery(internal.agent.operations.describeProject, {
      orgId: ctx.orgId,
      actorUserId: ctx.requestUserId,
      name: args.name,
    });
    const pending = await requireConfirmation(
      ctx,
      "deleteProject",
      args,
      `Move ${what} to the recycle bin (restorable for 30 days).`,
      input.confirmationCode
    );
    if (pending) return pending;
    const result = await ctx.runMutation(internal.agent.operations.deleteProject, {
      orgId: ctx.orgId,
      actorUserId: ctx.requestUserId,
      name: args.name,
    });
    return { status: "done", name: result.name };
  },
});

type TemplateSummary = {
  templateId: string;
  source: "builtin" | "custom";
  kind: "project" | "workspace";
  name: string;
  description?: string;
  preview: string[];
  issueCount: number;
  teamCount: number;
  labels: Array<{ name: string; color: string }>;
  cycleLengthDays?: number;
  color?: string;
  createdByName?: string;
  canDelete: boolean;
};

const listTemplates = createTool({
  description:
    "List project templates (a project + starter issues) and workspace templates (teams, labels, first cycle): built-in and this workspace's custom ones.",
  inputSchema: jsonSchema<{ kind?: "project" | "workspace" }>({
    type: "object",
    properties: { kind: { type: "string", enum: ["project", "workspace"] } },
    additionalProperties: false,
  }),
  execute: async (ctx: DevTrackToolCtx, input): Promise<TemplateSummary[]> => {
    return await ctx.runQuery(internal.agent.operations.listTemplates, {
      orgId: ctx.orgId,
      actorUserId: ctx.requestUserId,
      kind: input.kind,
    });
  },
});

const createProjectFromTemplate = createTool({
  description:
    "Create a project plus its starter issues from a project template, in one team. Runs immediately. Get templateId from listTemplates and teamKey from listTeams.",
  inputSchema: jsonSchema<Gated<{ templateId: string; teamKey: string; projectName?: string }>>({
    type: "object",
    properties: {
      templateId: { type: "string" },
      teamKey: { type: "string", description: "Team for the starter issues, e.g. ENG" },
      projectName: { type: "string", description: "Defaults to the template name" },
      ...confirmationCodeProp,
    },
    required: ["templateId", "teamKey"],
    additionalProperties: false,
  }),
  execute: async (
    ctx: DevTrackToolCtx,
    input
  ): Promise<GateResult<{ projectName: string; identifiers: string[] }>> => {
    const args = withoutCode(input);
    const what = await ctx.runQuery(internal.agent.operations.describeTemplate, {
      orgId: ctx.orgId,
      actorUserId: ctx.requestUserId,
      templateId: args.templateId,
    });
    const pending = await requireConfirmation(
      ctx,
      "createProjectFromTemplate",
      args,
      `Create project "${args.projectName ?? "(template name)"}" in team ${args.teamKey.toUpperCase()} from ${what}.`,
      input.confirmationCode
    );
    if (pending) return pending;
    const result = await ctx.runMutation(internal.agent.operations.createProjectFromTemplate, {
      orgId: ctx.orgId,
      actorUserId: ctx.requestUserId,
      ...args,
    });
    return { status: "done", projectName: result.projectName, identifiers: result.identifiers };
  },
});

type TemplateIssue = {
  title: string;
  description?: string;
  priority?: IssuePriority;
  status?: IssueStatus;
};

const createTemplate = createTool({
  description:
    "Save a new custom template for this workspace. kind 'project' needs issues (1-50); kind 'workspace' needs teams (key 1-5 letters) and/or labels (hex colors like #ef4444). Runs immediately; fill in sensible defaults instead of asking.",
  inputSchema: jsonSchema<
    Gated<{
      kind: "project" | "workspace";
      name: string;
      description?: string;
      issues?: TemplateIssue[];
      projectColor?: string;
      teams?: Array<{ name: string; key: string }>;
      labels?: Array<{ name: string; color: string }>;
      cycleLengthDays?: number;
    }>
  >({
    type: "object",
    properties: {
      kind: { type: "string", enum: ["project", "workspace"] },
      name: { type: "string" },
      description: { type: "string" },
      issues: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            priority: { type: "string", enum: [...ISSUE_PRIORITIES] },
            status: { type: "string", enum: [...ISSUE_STATUSES] },
          },
          required: ["title"],
          additionalProperties: false,
        },
      },
      projectColor: { type: "string", description: "Hex color for projects made from it" },
      teams: {
        type: "array",
        items: {
          type: "object",
          properties: { name: { type: "string" }, key: { type: "string" } },
          required: ["name", "key"],
          additionalProperties: false,
        },
      },
      labels: {
        type: "array",
        items: {
          type: "object",
          properties: { name: { type: "string" }, color: { type: "string" } },
          required: ["name", "color"],
          additionalProperties: false,
        },
      },
      cycleLengthDays: { type: "number", description: "First cycle length for new teams (1-90)" },
      ...confirmationCodeProp,
    },
    required: ["kind", "name"],
    additionalProperties: false,
  }),
  execute: async (ctx: DevTrackToolCtx, input): Promise<GateResult<{ name: string }>> => {
    const args = withoutCode(input);
    const summary =
      args.kind === "project"
        ? `Save project template "${args.name}" with ${args.issues?.length ?? 0} issues: ${(args.issues ?? []).map((i) => i.title).join("; ")}.`
        : `Save workspace template "${args.name}" with teams ${(args.teams ?? []).map((t) => `${t.name} (${t.key.toUpperCase()})`).join(", ") || "none"} and labels ${(args.labels ?? []).map((l) => l.name).join(", ") || "none"}${args.cycleLengthDays ? `, ${args.cycleLengthDays}-day first cycle` : ""}.`;
    const pending = await requireConfirmation(ctx, "createTemplate", args, summary, input.confirmationCode);
    if (pending) return pending;
    const result = await ctx.runMutation(internal.agent.operations.createTemplate, {
      orgId: ctx.orgId,
      actorUserId: ctx.requestUserId,
      kind: args.kind,
      name: args.name,
      description: args.description,
      project:
        args.kind === "project"
          ? { project: { color: args.projectColor }, issues: args.issues ?? [] }
          : undefined,
      workspace:
        args.kind === "workspace"
          ? { teams: args.teams ?? [], labels: args.labels ?? [], cycleLengthDays: args.cycleLengthDays }
          : undefined,
    });
    return { status: "done", name: result.name };
  },
});

const applyWorkspaceTemplate = createTool({
  description:
    "Set up THIS workspace from a workspace template: creates its teams (skipping existing keys), labels (skipping existing names) and a first cycle per new team. Admins only. Runs immediately.",
  inputSchema: jsonSchema<Gated<{ templateId: string }>>({
    type: "object",
    properties: { templateId: { type: "string" }, ...confirmationCodeProp },
    required: ["templateId"],
    additionalProperties: false,
  }),
  execute: async (
    ctx: DevTrackToolCtx,
    input
  ): Promise<GateResult<{ teamsCreated: string[]; labelsCreated: string[]; cyclesCreated: number; skipped: string[] }>> => {
    const args = withoutCode(input);
    const what = await ctx.runQuery(internal.agent.operations.describeTemplate, {
      orgId: ctx.orgId,
      actorUserId: ctx.requestUserId,
      templateId: args.templateId,
    });
    const pending = await requireConfirmation(
      ctx,
      "applyWorkspaceTemplate",
      args,
      `Apply ${what} to this workspace.`,
      input.confirmationCode
    );
    if (pending) return pending;
    const result = await ctx.runMutation(internal.agent.operations.applyWorkspaceTemplateToCurrent, {
      orgId: ctx.orgId,
      actorUserId: ctx.requestUserId,
      templateId: args.templateId,
    });
    return { status: "done", ...result };
  },
});

const createWorkspace = createTool({
  description:
    "Create a brand-new, separate workspace (organization) owned by the requesting user, optionally set up from a workspace template. Its data is fully separate from this workspace. Runs immediately and switches the user's screen to the new workspace. If the user gives no name, use their first name plus 's Workspace'.",
  inputSchema: jsonSchema<Gated<{ name: string; templateId?: string }>>({
    type: "object",
    properties: {
      name: { type: "string", description: "Workspace name, e.g. 'Acme Marketing'" },
      templateId: { type: "string", description: "Optional workspace template id from listTemplates" },
      ...confirmationCodeProp,
    },
    required: ["name"],
    additionalProperties: false,
  }),
  execute: async (
    ctx: DevTrackToolCtx,
    input
  ): Promise<
    GateResult<{ name: string; url: string; templateNote: string; clientAction: { switchWorkspace: string } }>
  > => {
    const args = withoutCode(input);
    const name = args.name.trim();
    if (!name || name.length > 80) {
      throw new Error("Workspace name must be 1-80 characters");
    }
    const templateText = args.templateId
      ? await ctx.runQuery(internal.agent.operations.describeTemplate, {
          orgId: ctx.orgId,
          actorUserId: ctx.requestUserId,
          templateId: args.templateId,
        })
      : "no template (empty workspace)";
    const pending = await requireConfirmation(
      ctx,
      "createWorkspace",
      args,
      `Create a new separate workspace "${name}" owned by you, set up with ${templateText}.`,
      input.confirmationCode
    );
    if (pending) return pending;

    const secret = process.env.CLERK_SECRET_KEY;
    if (!secret) {
      throw new Error("Creating workspaces needs CLERK_SECRET_KEY set on the Convex deployment");
    }
    const content = args.templateId
      ? await ctx.runQuery(internal.agent.operations.getWorkspaceTemplateContent, {
          orgId: ctx.orgId,
          actorUserId: ctx.requestUserId,
          templateId: args.templateId,
        })
      : null;
    const { clerkUserId } = await ctx.runQuery(internal.agent.operations.clerkUserForActor, {
      orgId: ctx.orgId,
      actorUserId: ctx.requestUserId,
    });
    const response = await fetch("https://api.clerk.com/v1/organizations", {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name, created_by: clerkUserId }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        errors?: Array<{ long_message?: string; message?: string }>;
      };
      throw new Error(
        `Clerk could not create the workspace: ${body.errors?.[0]?.long_message ?? body.errors?.[0]?.message ?? response.status}`
      );
    }
    const created = (await response.json()) as { id: string; slug: string };
    if (content) {
      await ctx.scheduler.runAfter(3_000, internal.agent.operations.applyTemplateToNewWorkspace, {
        clerkOrgId: created.id,
        actorUserId: ctx.requestUserId,
        content,
        attempt: 0,
      });
    }
    return {
      status: "done",
      name,
      url: `/${created.slug}`,
      templateNote: content
        ? "The template is applied automatically within a few seconds, once the workspace has synced."
        : "Empty workspace.",
      clientAction: { switchWorkspace: created.slug },
    };
  },
});

const listRecycleBin = createTool({
  description:
    "List items in the recycle bin (newest first) with their trashId. Members see what they deleted; admins see everything deleted in this workspace.",
  inputSchema: emptyInput,
  execute: async (
    ctx: DevTrackToolCtx
  ): Promise<
    Array<{ trashId: string; kind: string; label: string; deletedByName: string; deletedAt: string; daysLeft: number }>
  > => {
    return await ctx.runQuery(internal.agent.operations.listRecycleBin, {
      orgId: ctx.orgId,
      actorUserId: ctx.requestUserId,
    });
  },
});

const restoreFromRecycleBin = createTool({
  description:
    "Restore an item from the recycle bin by its trashId (from listRecycleBin). Restoring an issue brings back its comments, attachments, labels and links.",
  inputSchema: jsonSchema<{ trashId: string }>({
    type: "object",
    properties: { trashId: { type: "string" } },
    required: ["trashId"],
    additionalProperties: false,
  }),
  execute: async (
    ctx: DevTrackToolCtx,
    input
  ): Promise<{ kind: string; label: string; path: string | null }> => {
    return await ctx.runMutation(internal.agent.operations.restoreItem, {
      orgId: ctx.orgId,
      actorUserId: ctx.requestUserId,
      trashId: input.trashId,
    });
  },
});

// Screen control

const NAV_PAGE_LIST = [
  "home", "projects", "cycles", "ai", "templates", "trash", "search",
  "settings", "members", "billing", "issue", "project", "team", "teamBoard",
] as const;

/**
 * Moves the user's screen. The browser watches for this tool's result
 * (`clientAction.navigate`) and routes there, see components/ai/use-agent-navigation.ts.
 */
const navigateTo = createTool({
  description:
    "Open a page on the user's screen. Use whenever the user says open/show/go to/take me to something, and after creating something they will want to look at. page: home, projects, cycles, ai, templates, trash, search, settings, members, billing, issue (ref = identifier like ENG-42), project (ref = exact project name), team or teamBoard (ref = team key like ENG). Runs immediately.",
  inputSchema: jsonSchema<{ page: (typeof NAV_PAGE_LIST)[number]; ref?: string }>({
    type: "object",
    properties: {
      page: { type: "string", enum: [...NAV_PAGE_LIST] },
      ref: {
        type: "string",
        description: "Issue identifier, project name or team key, when the page needs one",
      },
    },
    required: ["page"],
    additionalProperties: false,
  }),
  execute: async (
    ctx: DevTrackToolCtx,
    input
  ): Promise<{ status: "done"; opened: string; clientAction: { navigate: string } }> => {
    const target: { path: string; label: string } = await ctx.runQuery(
      internal.agent.operations.resolveNavigation,
      { orgId: ctx.orgId, actorUserId: ctx.requestUserId, page: input.page, ref: input.ref }
    );
    return { status: "done", opened: target.label, clientAction: { navigate: target.path } };
  },
});

/**
 * Signs the user out of DevTrack. The browser performs it when it sees
 * `clientAction.signOut` (components/ai/use-agent-actions.ts).
 */
const signOut = createTool({
  description:
    "Log the user out of DevTrack. Use when they say log out, sign out or log me off. Runs immediately; say goodbye briefly.",
  inputSchema: emptyInput,
  execute: async (): Promise<{ status: "done"; clientAction: { signOut: true } }> => {
    return { status: "done", clientAction: { signOut: true } };
  },
});

/**
 * Opens the plan checkout on the billing page. The USER completes payment in
 * Clerk's checkout; the agent never sees or enters payment details.
 */
const startSubscription = createTool({
  description:
    "Start a new subscription or upgrade: opens the billing page with the checkout for the chosen plan, so the user can pay. Use for subscribe / upgrade / buy Pro / buy Enterprise / change plan. plan: pro or enterprise (default pro unless they're already on Pro). period: month or annual (default month). Only workspace admins can pay; the page tells others. You never handle payment details yourself.",
  inputSchema: jsonSchema<{ plan?: "pro" | "enterprise"; period?: "month" | "annual" }>({
    type: "object",
    properties: {
      plan: { type: "string", enum: ["pro", "enterprise"] },
      period: { type: "string", enum: ["month", "annual"] },
    },
    additionalProperties: false,
  }),
  execute: async (
    ctx: DevTrackToolCtx,
    input
  ): Promise<{ status: "done"; opened: string; note: string; clientAction: { navigate: string } }> => {
    const actor: { plan: string } = await ctx.runQuery(internal.agent.data.actorContext, {
      orgId: ctx.orgId,
      userId: ctx.requestUserId,
    });
    const plan = input.plan ?? (actor.plan === "pro" ? "enterprise" : "pro");
    if (actor.plan === plan || actor.plan === "enterprise") {
      return {
        status: "done",
        opened: "billing",
        note: `This workspace is already on ${actor.plan}. Opened billing so they can manage the subscription.`,
        clientAction: { navigate: "/settings/billing" },
      };
    }
    const period = input.period ?? "month";
    return {
      status: "done",
      opened: `checkout for ${plan} (${period})`,
      note: "The checkout is open on their screen; they enter payment details themselves.",
      clientAction: { navigate: `/settings/billing?checkout=${plan}&period=${period}` },
    };
  },
});

const createTeam = createTool({
  description:
    "Create a team in this workspace (admins only). key: 1-5 letters/digits starting with a letter, used in issue ids like ENG-1; derive it from the name if the user doesn't give one (Engineering -> ENG). Runs immediately. Create a team first when the workspace has none and the user wants issues.",
  inputSchema: jsonSchema<{ name: string; key: string; description?: string }>({
    type: "object",
    properties: {
      name: { type: "string" },
      key: { type: "string", description: "Team key, e.g. ENG" },
      description: { type: "string" },
    },
    required: ["name", "key"],
    additionalProperties: false,
  }),
  execute: async (
    ctx: DevTrackToolCtx,
    input
  ): Promise<{ status: "done"; name: string; key: string }> => {
    const result: { name: string; key: string } = await ctx.runMutation(
      internal.agent.operations.createTeam,
      { orgId: ctx.orgId, actorUserId: ctx.requestUserId, ...input }
    );
    return { status: "done", name: result.name, key: result.key };
  },
});

/**
 * Loom-style pointer: zooms the user's screen toward a place and spotlights
 * it with a short note (components/agent-widget/screen-guide.ts). Optionally
 * opens another page first.
 */
const showOnScreen = createTool({
  description:
    "Show the user WHERE something is: their screen zooms in on it, highlights it with a pulsing ring and your short note. Use for 'where is / show me / how do I / help me find' questions (e.g. where to log out -> target 'account-menu' with note 'Click your avatar, then Sign out'). target: a target id or label from the 'Places you can point at' list in the screen snapshot. If it lives on another page, also pass page (+ ref) like navigateTo and it opens that page first. Runs immediately.",
  inputSchema: jsonSchema<{ target: string; message: string; page?: (typeof NAV_PAGE_LIST)[number]; ref?: string }>({
    type: "object",
    properties: {
      target: { type: "string", description: "Target id or label to highlight" },
      message: { type: "string", description: "One short instruction shown next to it" },
      page: { type: "string", enum: [...NAV_PAGE_LIST] },
      ref: { type: "string" },
    },
    required: ["target", "message"],
    additionalProperties: false,
  }),
  execute: async (
    ctx: DevTrackToolCtx,
    input
  ): Promise<{
    status: "done";
    shown: string;
    clientAction: { navigate?: string; highlight: { target: string; message: string } };
  }> => {
    let navigate: string | undefined;
    if (input.page) {
      const target: { path: string } = await ctx.runQuery(internal.agent.operations.resolveNavigation, {
        orgId: ctx.orgId,
        actorUserId: ctx.requestUserId,
        page: input.page,
        ref: input.ref,
      });
      navigate = target.path;
    }
    const message = input.message.slice(0, 160);
    return {
      status: "done",
      shown: input.target,
      clientAction: { navigate, highlight: { target: input.target.slice(0, 80), message } },
    };
  },
});

export const devTrackTools = {
  showOnScreen,
  createTeam,
  signOut,
  startSubscription,
  navigateTo,
  listTeams,
  listMembers,
  projectStatus,
  searchIssues,
  findSimilarIssues,
  createIssue,
  updateIssue,
  deleteIssue,
  listMyIssues,
  prioritizeIssues,
  sortIssues,
  createProject,
  deleteProject,
  listTemplates,
  createProjectFromTemplate,
  createTemplate,
  applyWorkspaceTemplate,
  createWorkspace,
  listRecycleBin,
  restoreFromRecycleBin,
  cycleSummary,
  standupReport,
};
