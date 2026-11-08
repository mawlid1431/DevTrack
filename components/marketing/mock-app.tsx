import { LayoutGrid, ListFilter, Plus } from "lucide-react";
import { LabelChip } from "@/components/shared/label-chip";
import { PriorityIcon } from "@/components/shared/priority-icon";
import { StatusIcon } from "@/components/shared/status-icon";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Kbd } from "@/components/marketing/kbd";
import { HERO_ISSUE_GROUPS, type MockIssue } from "@/components/marketing/mock-data";
import { MockFrame, MockWindowBar } from "@/components/marketing/mock-window";
import { MockSidebar } from "@/components/marketing/mock-sidebar";

/**
 * The hero product mock: a full DevTrack workspace window (sidebar + grouped
 * issue list) built from the same primitives the real app uses.
 */
export function MockApp({ className }: { className?: string }) {
  return (
    <MockFrame className={className}>
      <MockWindowBar title="devtrack.app/acme/team/eng" />
      <div className="flex h-[26rem] text-[0.8125rem]">
        <MockSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-10 shrink-0 items-center gap-2 border-b px-4">
            <span className="font-medium">Engineering</span>
            <span className="text-muted-foreground/60">/</span>
            <span className="text-muted-foreground">Active issues</span>
            <div className="ml-auto flex items-center gap-1.5 text-muted-foreground">
              <span className="hidden items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs sm:flex">
                <ListFilter className="size-3" /> Filter
              </span>
              <span className="hidden items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs sm:flex">
                <LayoutGrid className="size-3" /> Board
              </span>
              <span className="flex items-center gap-1 rounded-md bg-primary px-1.5 py-0.5 text-xs text-primary-foreground">
                <Plus className="size-3" /> New issue
                <Kbd className="ml-0.5 h-4 border-0 bg-primary-foreground/15 text-primary-foreground">
                  C
                </Kbd>
              </span>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {HERO_ISSUE_GROUPS.map((group) => (
              <div key={group.label}>
                <div className="flex h-8 items-center gap-2 border-b bg-muted/40 px-4">
                  <StatusIcon status={group.status} className="size-3.5" />
                  <span className="text-xs font-medium">{group.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {group.issues.length}
                  </span>
                </div>
                {group.issues.map((issue) => (
                  <MockIssueRow key={issue.id} issue={issue} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </MockFrame>
  );
}

export function MockIssueRow({ issue }: { issue: MockIssue }) {
  return (
    <div className="flex h-9 items-center gap-3 border-b px-4 transition-colors hover:bg-accent/50">
      <PriorityIcon priority={issue.priority} className="size-3.5" />
      <span className="w-14 shrink-0 font-mono text-[0.6875rem] text-muted-foreground">
        {issue.id}
      </span>
      <StatusIcon status={issue.status} className="size-3.5" />
      <span className="min-w-0 flex-1 truncate font-medium">{issue.title}</span>
      {issue.label ? (
        <LabelChip
          name={issue.label.name}
          color={issue.label.color}
          className="hidden py-0 text-[0.625rem] lg:inline-flex"
        />
      ) : null}
      {issue.due ? (
        <span className="hidden shrink-0 text-[0.6875rem] text-muted-foreground sm:block">
          {issue.due}
        </span>
      ) : null}
      {issue.assignee ? (
        <UserAvatar name={issue.assignee} />
      ) : (
        <span className="size-5 rounded-full border border-dashed border-muted-foreground/40" />
      )}
    </div>
  );
}
