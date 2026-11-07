import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import { MutationCtx, internalMutation } from "./_generated/server";
import { logActivity } from "./lib/activity";
import {
  orgAdminMutation,
  orgMutation,
  orgQuery,
} from "./lib/customFunctions";
import { assertCanCreateIssue, assertCanCreateProject } from "./lib/limits";
import { trashKindValidator } from "./schema";

/**
 * Recycle bin.
 *
 * Deleting anything (issue, project, cycle, comment, attachment, saved view,
 * template) moves it here as a JSON snapshot that includes its dependent
 * records, then removes the originals. Restoring rebuilds them. Attachment
 * files stay in storage until the item is purged for good.
 *
 * Privacy: every row is scoped to one organization. Members see and restore
 * only what THEY deleted; admins see and manage the whole org's bin.
 * Retention: 30 days, then the daily cron in crons.ts purges it.
 */

export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

type TrashKind = Doc<"trash">["kind"];
type Stripped<T> = Omit<T, "_id" | "_creationTime">;
type RelationType = Doc<"issueRelations">["type"];

function strip<T extends { _id: unknown; _creationTime: number }>(doc: T): Stripped<T> {
  const { _id, _creationTime, ...rest } = doc;
  void _id;
  void _creationTime;
  return rest;
}

type IssueSnapshot = {
  issue: Omit<Stripped<Doc<"issues">>, "embedding">;
  labelIds: Id<"labels">[];
  comments: Array<Omit<Stripped<Doc<"comments">>, "issueId">>;
  attachments: Array<Omit<Stripped<Doc<"attachments">>, "issueId">>;
  activity: Array<Omit<Stripped<Doc<"activity">>, "issueId">>;
  relations: Array<{
    otherIssueId: Id<"issues">;
    type: RelationType;
    direction: "out" | "in";
  }>;
  childIds: Id<"issues">[];
};
type ProjectSnapshot = { project: Stripped<Doc<"projects">>; issueIds: Id<"issues">[] };
type CycleSnapshot = { cycle: Stripped<Doc<"cycles">>; issueIds: Id<"issues">[] };
type CommentSnapshot = { comment: Stripped<Doc<"comments">> };
type AttachmentSnapshot = { attachment: Stripped<Doc<"attachments">> };
type ViewSnapshot = { view: Stripped<Doc<"views">> };
type TemplateSnapshot = { template: Stripped<Doc<"templates">> };

async function insertTrash(
  ctx: MutationCtx,
  entry: {
    orgId: Id<"organizations">;
    actorId: Id<"users">;
    kind: TrashKind;
    label: string;
    snapshot: unknown;
    storageIds?: Id<"_storage">[];
  }
): Promise<Id<"trash">> {
  const now = Date.now();
  return await ctx.db.insert("trash", {
    orgId: entry.orgId,
    kind: entry.kind,
    label: entry.label.slice(0, 200),
    deletedBy: entry.actorId,
    deletedAt: now,
    expiresAt: now + TRASH_RETENTION_MS,
    snapshot: JSON.stringify(entry.snapshot),
    storageIds: entry.storageIds ?? [],
  });
}

async function issueIdentifier(ctx: MutationCtx, issue: Doc<"issues">): Promise<string> {
  const team = await ctx.db.get(issue.teamId);
  return `${team?.key ?? "?"}-${issue.number}`;
}

// ── Move to trash (called by every delete mutation) ───────────────────────

export async function trashIssue(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  actorId: Id<"users">,
  issue: Doc<"issues">
): Promise<Id<"trash">> {
  const labelLinks = await ctx.db
    .query("issueLabels")
    .withIndex("by_issue", (q) => q.eq("issueId", issue._id))
    .collect();
  const comments = await ctx.db
    .query("comments")
    .withIndex("by_issue", (q) => q.eq("issueId", issue._id))
    .collect();
  const attachments = await ctx.db
    .query("attachments")
    .withIndex("by_issue", (q) => q.eq("issueId", issue._id))
    .collect();
  const activity = await ctx.db
    .query("activity")
    .withIndex("by_issue", (q) => q.eq("issueId", issue._id))
    .collect();
  const outgoing = await ctx.db
    .query("issueRelations")
    .withIndex("by_issue", (q) => q.eq("issueId", issue._id))
    .collect();
  const incoming = await ctx.db
    .query("issueRelations")
    .withIndex("by_related", (q) => q.eq("relatedIssueId", issue._id))
    .collect();
  const children = await ctx.db
    .query("issues")
    .withIndex("by_parent", (q) => q.eq("parentIssueId", issue._id))
    .collect();

  const { embedding, ...issueFields } = strip(issue);
  void embedding;
  const snapshot: IssueSnapshot = {
    issue: issueFields,
    labelIds: labelLinks.map((l) => l.labelId),
    comments: comments.map((c) => {
      const { issueId, ...rest } = strip(c);
      void issueId;
      return rest;
    }),
    attachments: attachments.map((a) => {
      const { issueId, ...rest } = strip(a);
      void issueId;
      return rest;
    }),
    activity: activity.map((a) => {
      const { issueId, ...rest } = strip(a);
      void issueId;
      return rest;
    }),
    relations: [
      ...outgoing.map((r) => ({
        otherIssueId: r.relatedIssueId,
        type: r.type,
        direction: "out" as const,
      })),
      ...incoming.map((r) => ({
        otherIssueId: r.issueId,
        type: r.type,
        direction: "in" as const,
      })),
    ],
    childIds: children.map((c) => c._id),
  };
  const label = `${await issueIdentifier(ctx, issue)} · ${issue.title}`;
  const trashId = await insertTrash(ctx, {
    orgId,
    actorId,
    kind: "issue",
    label,
    snapshot,
    storageIds: attachments.map((a) => a.storageId),
  });

  for (const doc of [...labelLinks, ...comments, ...attachments, ...activity, ...outgoing, ...incoming]) {
    await ctx.db.delete(doc._id);
  }
  // Sub-issues survive as top-level issues; restore re-attaches them.
  for (const child of children) {
    await ctx.db.patch(child._id, { parentIssueId: undefined });
  }
  await ctx.db.delete(issue._id);
  return trashId;
}

export async function trashProject(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  actorId: Id<"users">,
  project: Doc<"projects">
): Promise<Id<"trash">> {
  const issues = (
    await ctx.db
      .query("issues")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .collect()
  ).filter((i) => i.orgId === orgId);
  const snapshot: ProjectSnapshot = {
    project: strip(project),
    issueIds: issues.map((i) => i._id),
  };
  const trashId = await insertTrash(ctx, {
    orgId,
    actorId,
    kind: "project",
    label: project.name,
    snapshot,
  });
  for (const issue of issues) {
    await ctx.db.patch(issue._id, { projectId: undefined });
    await logActivity(ctx, {
      orgId,
      issueId: issue._id,
      actorId,
      type: "project_changed",
      field: "project",
      oldValue: project.name,
      newValue: undefined,
    });
  }
  await ctx.db.delete(project._id);
  return trashId;
}

export async function trashCycle(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  actorId: Id<"users">,
  cycle: Doc<"cycles">
): Promise<Id<"trash">> {
  const issues = (
    await ctx.db
      .query("issues")
      .withIndex("by_cycle", (q) => q.eq("cycleId", cycle._id))
      .collect()
  ).filter((i) => i.orgId === orgId);
  const team = await ctx.db.get(cycle.teamId);
  const cycleName = cycle.name ?? `Cycle ${cycle.number}`;
  const trashId = await insertTrash(ctx, {
    orgId,
    actorId,
    kind: "cycle",
    label: `${team?.key ?? "?"} · ${cycleName}`,
    snapshot: { cycle: strip(cycle), issueIds: issues.map((i) => i._id) } satisfies CycleSnapshot,
  });
  for (const issue of issues) {
    await ctx.db.patch(issue._id, { cycleId: undefined });
    await logActivity(ctx, {
      orgId,
      issueId: issue._id,
      actorId,
      type: "cycle_changed",
      field: "cycle",
      oldValue: cycleName,
      newValue: undefined,
    });
  }
  await ctx.db.delete(cycle._id);
  return trashId;
}

export async function trashComment(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  actorId: Id<"users">,
  comment: Doc<"comments">
): Promise<Id<"trash">> {
  const issue = await ctx.db.get(comment.issueId);
  const where = issue ? await issueIdentifier(ctx, issue) : "an issue";
  const preview = comment.body.replace(/\s+/g, " ").slice(0, 80);
  const trashId = await insertTrash(ctx, {
    orgId,
    actorId,
    kind: "comment",
    label: `Comment on ${where}: ${preview}`,
    snapshot: { comment: strip(comment) } satisfies CommentSnapshot,
  });
  await ctx.db.delete(comment._id);
  return trashId;
}

export async function trashAttachment(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  actorId: Id<"users">,
  attachment: Doc<"attachments">
): Promise<Id<"trash">> {
  const issue = await ctx.db.get(attachment.issueId);
  const where = issue ? await issueIdentifier(ctx, issue) : "an issue";
  const trashId = await insertTrash(ctx, {
    orgId,
    actorId,
    kind: "attachment",
    label: `${attachment.fileName} (on ${where})`,
    snapshot: { attachment: strip(attachment) } satisfies AttachmentSnapshot,
    storageIds: [attachment.storageId],
  });
  await ctx.db.delete(attachment._id);
  return trashId;
}

export async function trashView(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  actorId: Id<"users">,
  view: Doc<"views">
): Promise<Id<"trash">> {
  const trashId = await insertTrash(ctx, {
    orgId,
    actorId,
    kind: "view",
    label: `Saved view · ${view.name}`,
    snapshot: { view: strip(view) } satisfies ViewSnapshot,
  });
  await ctx.db.delete(view._id);
  return trashId;
}

export async function trashTemplate(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  actorId: Id<"users">,
  template: Doc<"templates">
): Promise<Id<"trash">> {
  const trashId = await insertTrash(ctx, {
    orgId,
    actorId,
    kind: "template",
    label: `${template.kind === "project" ? "Project" : "Workspace"} template · ${template.name}`,
    snapshot: { template: strip(template) } satisfies TemplateSnapshot,
  });
  await ctx.db.delete(template._id);
  return trashId;
}

// ── Restore ───────────────────────────────────────────────────────────────

async function existsInOrg<T extends "issues" | "projects" | "cycles" | "labels" | "teams">(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  id: Id<T> | undefined
): Promise<boolean> {
  if (!id) return false;
  const doc = (await ctx.db.get(id)) as { orgId?: Id<"organizations"> } | null;
  return doc !== null && doc.orgId === orgId;
}

async function isMember(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  userId: Id<"users"> | undefined
): Promise<boolean> {
  if (!userId) return false;
  const membership = await ctx.db
    .query("members")
    .withIndex("by_org_and_user", (q) => q.eq("orgId", orgId).eq("userId", userId))
    .unique();
  return membership !== null;
}

async function storageExists(ctx: MutationCtx, storageId: Id<"_storage">): Promise<boolean> {
  return (await ctx.db.system.get(storageId)) !== null;
}

type RestoreResult = { path: string | null };

async function restoreIssue(
  ctx: MutationCtx,
  org: Doc<"organizations">,
  actorId: Id<"users">,
  snap: IssueSnapshot
): Promise<RestoreResult> {
  const team = await ctx.db.get(snap.issue.teamId);
  if (!team || team.orgId !== org._id) {
    throw new Error("Can't restore: the issue's team no longer exists");
  }
  await assertCanCreateIssue(ctx, org);

  // Keep the original number (ENG-42) unless something has taken it since.
  const taken = await ctx.db
    .query("issues")
    .withIndex("by_team_and_number", (q) => q.eq("teamId", team._id).eq("number", snap.issue.number))
    .first();
  let number = snap.issue.number;
  if (taken) {
    number = team.nextIssueNumber;
    await ctx.db.patch(team._id, { nextIssueNumber: number + 1 });
  }

  const issueId = await ctx.db.insert("issues", {
    ...snap.issue,
    orgId: org._id,
    number,
    projectId: (await existsInOrg(ctx, org._id, snap.issue.projectId)) ? snap.issue.projectId : undefined,
    cycleId: (await existsInOrg(ctx, org._id, snap.issue.cycleId)) ? snap.issue.cycleId : undefined,
    parentIssueId: (await existsInOrg(ctx, org._id, snap.issue.parentIssueId))
      ? snap.issue.parentIssueId
      : undefined,
    assigneeId: (await isMember(ctx, org._id, snap.issue.assigneeId)) ? snap.issue.assigneeId : undefined,
  });

  for (const labelId of snap.labelIds) {
    if (await existsInOrg(ctx, org._id, labelId)) {
      await ctx.db.insert("issueLabels", { issueId, labelId });
    }
  }
  for (const comment of snap.comments) {
    await ctx.db.insert("comments", { ...comment, orgId: org._id, issueId });
  }
  for (const attachment of snap.attachments) {
    if (await storageExists(ctx, attachment.storageId)) {
      await ctx.db.insert("attachments", { ...attachment, orgId: org._id, issueId });
    }
  }
  for (const entry of snap.activity) {
    await ctx.db.insert("activity", { ...entry, orgId: org._id, issueId });
  }
  for (const relation of snap.relations) {
    if (await existsInOrg(ctx, org._id, relation.otherIssueId)) {
      await ctx.db.insert(
        "issueRelations",
        relation.direction === "out"
          ? { issueId, relatedIssueId: relation.otherIssueId, type: relation.type }
          : { issueId: relation.otherIssueId, relatedIssueId: issueId, type: relation.type }
      );
    }
  }
  for (const childId of snap.childIds) {
    const child = await ctx.db.get(childId);
    if (child && child.orgId === org._id && child.parentIssueId === undefined) {
      await ctx.db.patch(child._id, { parentIssueId: issueId });
    }
  }
  await logActivity(ctx, { orgId: org._id, issueId, actorId, type: "restored" });
  await ctx.scheduler.runAfter(0, internal.agent.embeddings.embedIssue, { issueId });
  return { path: `/issue/${issueId}` };
}

async function restoreProject(
  ctx: MutationCtx,
  org: Doc<"organizations">,
  snap: ProjectSnapshot
): Promise<RestoreResult> {
  await assertCanCreateProject(ctx, org);
  const projectId = await ctx.db.insert("projects", {
    ...snap.project,
    orgId: org._id,
    leadId: (await isMember(ctx, org._id, snap.project.leadId)) ? snap.project.leadId : undefined,
  });
  for (const id of snap.issueIds) {
    const issue = await ctx.db.get(id);
    if (issue && issue.orgId === org._id && issue.projectId === undefined) {
      await ctx.db.patch(issue._id, { projectId });
    }
  }
  return { path: `/projects/${projectId}` };
}

async function restoreCycle(
  ctx: MutationCtx,
  org: Doc<"organizations">,
  snap: CycleSnapshot
): Promise<RestoreResult> {
  const team = await ctx.db.get(snap.cycle.teamId);
  if (!team || team.orgId !== org._id) {
    throw new Error("Can't restore: the cycle's team no longer exists");
  }
  const cycles = await ctx.db
    .query("cycles")
    .withIndex("by_team", (q) => q.eq("teamId", team._id))
    .collect();
  const clash = cycles.find(
    (c) => snap.cycle.startDate < c.endDate && c.startDate < snap.cycle.endDate
  );
  if (clash) {
    throw new Error(
      `Can't restore: these dates now overlap ${clash.name ?? `Cycle ${clash.number}`}`
    );
  }
  const numberTaken = cycles.some((c) => c.number === snap.cycle.number);
  const number = numberTaken
    ? Math.max(0, ...cycles.map((c) => c.number)) + 1
    : snap.cycle.number;
  const cycleId = await ctx.db.insert("cycles", { ...snap.cycle, orgId: org._id, number });
  for (const id of snap.issueIds) {
    const issue = await ctx.db.get(id);
    if (issue && issue.orgId === org._id && issue.cycleId === undefined) {
      await ctx.db.patch(issue._id, { cycleId });
    }
  }
  return { path: `/cycles/${cycleId}` };
}

async function restoreRow(
  ctx: MutationCtx,
  org: Doc<"organizations">,
  kind: TrashKind,
  snapshot: string,
  actorId: Id<"users">
): Promise<RestoreResult> {
  switch (kind) {
    case "issue":
      return await restoreIssue(ctx, org, actorId, JSON.parse(snapshot) as IssueSnapshot);
    case "project":
      return await restoreProject(ctx, org, JSON.parse(snapshot) as ProjectSnapshot);
    case "cycle":
      return await restoreCycle(ctx, org, JSON.parse(snapshot) as CycleSnapshot);
    case "comment": {
      const { comment } = JSON.parse(snapshot) as CommentSnapshot;
      if (!(await existsInOrg(ctx, org._id, comment.issueId))) {
        throw new Error("Can't restore: the comment's issue was deleted. Restore the issue first.");
      }
      await ctx.db.insert("comments", { ...comment, orgId: org._id });
      return { path: `/issue/${comment.issueId}` };
    }
    case "attachment": {
      const { attachment } = JSON.parse(snapshot) as AttachmentSnapshot;
      if (!(await existsInOrg(ctx, org._id, attachment.issueId))) {
        throw new Error("Can't restore: the attachment's issue was deleted. Restore the issue first.");
      }
      if (!(await storageExists(ctx, attachment.storageId))) {
        throw new Error("Can't restore: the file is no longer in storage");
      }
      await ctx.db.insert("attachments", { ...attachment, orgId: org._id });
      await logActivity(ctx, {
        orgId: org._id,
        issueId: attachment.issueId,
        actorId,
        type: "attachment_restored",
        field: "attachment",
        newValue: attachment.fileName,
      });
      return { path: `/issue/${attachment.issueId}` };
    }
    case "view": {
      const { view } = JSON.parse(snapshot) as ViewSnapshot;
      await ctx.db.insert("views", { ...view, orgId: org._id });
      return { path: null };
    }
    case "template": {
      const { template } = JSON.parse(snapshot) as TemplateSnapshot;
      await ctx.db.insert("templates", { ...template, orgId: org._id });
      return { path: "/templates" };
    }
  }
}

/** Members manage their own deletions; admins manage everything in the org. */
function canManage(
  entry: Doc<"trash">,
  userId: Id<"users">,
  role: Doc<"members">["role"]
): boolean {
  return entry.deletedBy === userId || role === "admin";
}

async function getManageableEntry(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  userId: Id<"users">,
  role: Doc<"members">["role"],
  trashId: Id<"trash">
): Promise<Doc<"trash">> {
  const entry = await ctx.db.get(trashId);
  // Same "not found" for other orgs and for other members' items: no leaks.
  if (!entry || entry.orgId !== orgId || !canManage(entry, userId, role)) {
    throw new Error("Item not found in your recycle bin");
  }
  return entry;
}

/** Shared by the public mutation and the AI agent. */
export async function restoreFromTrash(
  ctx: MutationCtx,
  org: Doc<"organizations">,
  userId: Id<"users">,
  role: Doc<"members">["role"],
  trashId: Id<"trash">
): Promise<{ kind: TrashKind; label: string; path: string | null }> {
  const entry = await getManageableEntry(ctx, org._id, userId, role, trashId);
  const { path } = await restoreRow(ctx, org, entry.kind, entry.snapshot, userId);
  await ctx.db.delete(entry._id);
  return { kind: entry.kind, label: entry.label, path };
}

async function purgeEntry(ctx: MutationCtx, entry: Doc<"trash">): Promise<void> {
  for (const storageId of entry.storageIds) {
    // A restored attachment re-uses its blob, so only delete orphans.
    const stillUsed = await ctx.db
      .query("attachments")
      .withIndex("by_storage", (q) => q.eq("storageId", storageId))
      .first();
    if (!stillUsed && (await storageExists(ctx, storageId))) {
      await ctx.storage.delete(storageId);
    }
  }
  await ctx.db.delete(entry._id);
}

// ── Public API ────────────────────────────────────────────────────────────

const trashItemValidator = v.object({
  trashId: v.id("trash"),
  kind: trashKindValidator,
  label: v.string(),
  deletedAt: v.number(),
  expiresAt: v.number(),
  deletedByName: v.string(),
  deletedByMe: v.boolean(),
});

export const list = orgQuery({
  args: { scope: v.optional(v.union(v.literal("mine"), v.literal("all"))) },
  returns: v.object({
    isAdmin: v.boolean(),
    scope: v.union(v.literal("mine"), v.literal("all")),
    items: v.array(trashItemValidator),
  }),
  handler: async (ctx, args) => {
    const isAdmin = ctx.membership.role === "admin";
    // Non-admins can only ever see their own deletions.
    const scope: "mine" | "all" =
      isAdmin && args.scope === "all" ? "all" : "mine";
    const rows =
      scope === "all"
        ? await ctx.db
            .query("trash")
            .withIndex("by_org", (q) => q.eq("orgId", ctx.org._id))
            .order("desc")
            .take(200)
        : await ctx.db
            .query("trash")
            .withIndex("by_org_and_deleter", (q) =>
              q.eq("orgId", ctx.org._id).eq("deletedBy", ctx.user._id)
            )
            .order("desc")
            .take(200);
    const names = new Map<Id<"users">, string>();
    const items = [];
    for (const row of rows) {
      if (!names.has(row.deletedBy)) {
        const user = await ctx.db.get(row.deletedBy);
        names.set(row.deletedBy, user?.name ?? "Former member");
      }
      items.push({
        trashId: row._id,
        kind: row.kind,
        label: row.label,
        deletedAt: row.deletedAt,
        expiresAt: row.expiresAt,
        deletedByName: names.get(row.deletedBy)!,
        deletedByMe: row.deletedBy === ctx.user._id,
      });
    }
    return { isAdmin, scope, items };
  },
});

export const restore = orgMutation({
  args: { trashId: v.id("trash") },
  returns: v.object({
    kind: trashKindValidator,
    label: v.string(),
    path: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    return await restoreFromTrash(ctx, ctx.org, ctx.user._id, ctx.membership.role, args.trashId);
  },
});

export const deleteForever = orgMutation({
  args: { trashId: v.id("trash") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const entry = await getManageableEntry(
      ctx,
      ctx.org._id,
      ctx.user._id,
      ctx.membership.role,
      args.trashId
    );
    await purgeEntry(ctx, entry);
    return null;
  },
});

/** Admins only: permanently delete everything in the org's bin. */
export const empty = orgAdminMutation({
  args: {},
  returns: v.object({ deleted: v.number(), remaining: v.boolean() }),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("trash")
      .withIndex("by_org", (q) => q.eq("orgId", ctx.org._id))
      .take(200);
    for (const row of rows) {
      await purgeEntry(ctx, row);
    }
    return { deleted: rows.length, remaining: rows.length === 200 };
  },
});

/** Daily cron: permanently remove items older than 30 days. */
export const purgeExpired = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const expired = await ctx.db
      .query("trash")
      .withIndex("by_expires", (q) => q.lt("expiresAt", Date.now()))
      .take(100);
    for (const row of expired) {
      await purgeEntry(ctx, row);
    }
    if (expired.length === 100) {
      await ctx.scheduler.runAfter(0, internal.trash.purgeExpired, {});
    }
    return expired.length;
  },
});
