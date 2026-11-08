import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Shared validators, import these from feature code instead of redefining.
 * The schema is FROZEN for parallel track work: coordinate before editing this file.
 */
export const issueStatusValidator = v.union(
  v.literal("backlog"),
  v.literal("todo"),
  v.literal("in_progress"),
  v.literal("in_review"),
  v.literal("done"),
  v.literal("canceled")
);

export const issuePriorityValidator = v.union(
  v.literal("none"),
  v.literal("urgent"),
  v.literal("high"),
  v.literal("medium"),
  v.literal("low")
);

export const planValidator = v.union(
  v.literal("free"),
  v.literal("pro"),
  v.literal("enterprise")
);

export const memberRoleValidator = v.union(
  v.literal("admin"),
  v.literal("member")
);

export const projectStatusValidator = v.union(
  v.literal("backlog"),
  v.literal("planned"),
  v.literal("in_progress"),
  v.literal("paused"),
  v.literal("completed"),
  v.literal("canceled")
);

export const issueRelationTypeValidator = v.union(
  v.literal("blocks"),
  v.literal("blocked_by"),
  v.literal("related"),
  v.literal("duplicate_of")
);

/** Kinds of records the recycle bin can hold and restore. */
export const trashKindValidator = v.union(
  v.literal("issue"),
  v.literal("project"),
  v.literal("cycle"),
  v.literal("comment"),
  v.literal("attachment"),
  v.literal("view"),
  v.literal("template")
);

export const templateKindValidator = v.union(
  v.literal("project"),
  v.literal("workspace")
);

export default defineSchema({
  // Synced from Clerk via webhooks
  users: defineTable({
    clerkId: v.string(),
    name: v.string(),
    email: v.string(),
    imageUrl: v.optional(v.string()),
    /** When the user finished or skipped the first-visit tour (shown once per account). */
    tourCompletedAt: v.optional(v.number()),
    /** Slug of the workspace they last opened, so sign-in returns them there. */
    lastOrgSlug: v.optional(v.string()),
  }).index("by_clerk_id", ["clerkId"]),

  organizations: defineTable({
    clerkOrgId: v.string(),
    name: v.string(),
    slug: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    plan: planValidator,
    subscriptionStatus: v.optional(v.string()),
  })
    .index("by_clerk_org_id", ["clerkOrgId"])
    .index("by_slug", ["slug"]),

  members: defineTable({
    orgId: v.id("organizations"),
    userId: v.id("users"),
    role: memberRoleValidator,
    clerkMembershipId: v.string(),
  })
    .index("by_org", ["orgId"])
    .index("by_user", ["userId"])
    .index("by_org_and_user", ["orgId", "userId"])
    .index("by_clerk_membership_id", ["clerkMembershipId"]),

  // Workspace structure
  teams: defineTable({
    orgId: v.id("organizations"),
    name: v.string(),
    /** Issue prefix, e.g. "ENG" → ENG-123 */
    key: v.string(),
    description: v.optional(v.string()),
    /** Per-team issue number sequence */
    nextIssueNumber: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_and_key", ["orgId", "key"]),

  issues: defineTable({
    orgId: v.id("organizations"),
    teamId: v.id("teams"),
    /** Per-team sequence number, displayed as KEY-number */
    number: v.number(),
    title: v.string(),
    description: v.optional(v.string()),
    status: issueStatusValidator,
    priority: issuePriorityValidator,
    assigneeId: v.optional(v.id("users")),
    creatorId: v.id("users"),
    projectId: v.optional(v.id("projects")),
    cycleId: v.optional(v.id("cycles")),
    parentIssueId: v.optional(v.id("issues")),
    estimate: v.optional(v.number()),
    /** Due date as ms since epoch */
    dueDate: v.optional(v.number()),
    /** Fractional ranking for board/list ordering */
    sortOrder: v.number(),
    /** Embedding for semantic duplicate detection (Track D fills this) */
    embedding: v.optional(v.array(v.float64())),
  })
    .index("by_org", ["orgId"])
    .index("by_team", ["teamId"])
    .index("by_team_and_number", ["teamId", "number"])
    .index("by_team_and_status", ["teamId", "status"])
    .index("by_assignee", ["orgId", "assigneeId"])
    .index("by_project", ["projectId"])
    .index("by_cycle", ["cycleId"])
    .index("by_parent", ["parentIssueId"])
    .searchIndex("search_title", {
      searchField: "title",
      filterFields: ["orgId", "teamId"],
    })
    .searchIndex("search_description", {
      searchField: "description",
      filterFields: ["orgId", "teamId"],
    })
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["orgId"],
    }),

  labels: defineTable({
    orgId: v.id("organizations"),
    name: v.string(),
    /** Hex color, e.g. "#4B637D" */
    color: v.string(),
  }).index("by_org", ["orgId"]),

  issueLabels: defineTable({
    issueId: v.id("issues"),
    labelId: v.id("labels"),
  })
    .index("by_issue", ["issueId"])
    .index("by_label", ["labelId"]),

  issueRelations: defineTable({
    issueId: v.id("issues"),
    relatedIssueId: v.id("issues"),
    type: issueRelationTypeValidator,
  })
    .index("by_issue", ["issueId"])
    .index("by_related", ["relatedIssueId"]),

  comments: defineTable({
    orgId: v.id("organizations"),
    issueId: v.id("issues"),
    authorId: v.id("users"),
    body: v.string(),
    /** User ids @mentioned in the body */
    mentions: v.optional(v.array(v.id("users"))),
  }).index("by_issue", ["issueId"]),

  activity: defineTable({
    orgId: v.id("organizations"),
    issueId: v.id("issues"),
    actorId: v.id("users"),
    /** e.g. "created" | "status_changed" | "assigned" | "labeled" | "commented" */
    type: v.string(),
    field: v.optional(v.string()),
    oldValue: v.optional(v.string()),
    newValue: v.optional(v.string()),
  })
    .index("by_issue", ["issueId"])
    .index("by_org", ["orgId"]),

  projects: defineTable({
    orgId: v.id("organizations"),
    name: v.string(),
    description: v.optional(v.string()),
    status: projectStatusValidator,
    leadId: v.optional(v.id("users")),
    /** Target date as ms since epoch */
    targetDate: v.optional(v.number()),
    color: v.optional(v.string()),
  }).index("by_org", ["orgId"]),

  cycles: defineTable({
    orgId: v.id("organizations"),
    teamId: v.id("teams"),
    /** Per-team cycle sequence: Cycle 1, Cycle 2, ... */
    number: v.number(),
    name: v.optional(v.string()),
    startDate: v.number(),
    endDate: v.number(),
    /** Set once its unfinished issues have rolled into the next cycle. */
    rolledOverAt: v.optional(v.number()),
  })
    .index("by_team", ["teamId"])
    .index("by_team_and_number", ["teamId", "number"])
    .index("by_rolled_and_end", ["rolledOverAt", "endDate"]),

  attachments: defineTable({
    orgId: v.id("organizations"),
    issueId: v.id("issues"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    fileType: v.string(),
    fileSize: v.number(),
    uploadedBy: v.id("users"),
  })
    .index("by_issue", ["issueId"])
    .index("by_storage", ["storageId"]),

  views: defineTable({
    orgId: v.id("organizations"),
    creatorId: v.id("users"),
    name: v.string(),
    /** JSON-serialized filter configuration (owned by Track A) */
    filters: v.string(),
    shared: v.boolean(),
  })
    .index("by_org", ["orgId"])
    .index("by_creator", ["creatorId"]),

  /**
   * Recycle bin. Deleting moves a record here as a JSON snapshot (with its
   * dependent records, e.g. an issue's comments and attachments) so it can be
   * restored. Rows expire after 30 days and are purged by a daily cron.
   * Privacy: members only see their own deletions; admins see the org's.
   */
  trash: defineTable({
    orgId: v.id("organizations"),
    kind: trashKindValidator,
    /** Human label shown in the bin, e.g. "ENG-42 · Fix login" */
    label: v.string(),
    deletedBy: v.id("users"),
    deletedAt: v.number(),
    expiresAt: v.number(),
    /** JSON snapshot used to rebuild the record on restore */
    snapshot: v.string(),
    /** Storage blobs kept alive for restore; deleted on permanent purge */
    storageIds: v.array(v.id("_storage")),
  })
    .index("by_org", ["orgId", "deletedAt"])
    .index("by_org_and_deleter", ["orgId", "deletedBy", "deletedAt"])
    .index("by_expires", ["expiresAt"]),

  /** Custom project / workspace templates (built-ins live in code). */
  templates: defineTable({
    orgId: v.id("organizations"),
    creatorId: v.id("users"),
    kind: templateKindValidator,
    name: v.string(),
    description: v.optional(v.string()),
    /** JSON: ProjectTemplateContent | WorkspaceTemplateContent */
    content: v.string(),
  }).index("by_org", ["orgId"]),

  /**
   * Live voice calls with the agent (LiveKit). A row binds one LiveKit room
   * to the (org, user, thread) that started it, so the voice worker can only
   * ever act as that user, in that workspace, while the session is live.
   */
  voiceSessions: defineTable({
    orgId: v.id("organizations"),
    userId: v.id("users"),
    threadId: v.string(),
    roomName: v.string(),
    expiresAt: v.number(),
    tokenIssued: v.boolean(),
    /** Latest snapshot of the user's DevTrack screen during the call. */
    screen: v.optional(v.string()),
  }).index("by_room", ["roomName"]),
});
