"use client";

import {
  AtSign,
  Bot,
  CircleCheck,
  LayoutGrid,
  ListFilter,
  Plus,
  Search,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { useCallback, useState } from "react";
import { LabelChip } from "@/components/shared/label-chip";
import { PriorityIcon } from "@/components/shared/priority-icon";
import { StatusIcon } from "@/components/shared/status-icon";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Kbd } from "@/components/marketing/kbd";
import {
  HERO_ISSUE_GROUPS,
  MOCK_LABELS,
  MOCK_PEOPLE,
  type MockIssue,
} from "@/components/marketing/mock-data";
import { MockSidebar } from "@/components/marketing/mock-sidebar";
import { MockFrame, MockWindowBar } from "@/components/marketing/mock-window";

/**
 * The hero product mock: a DevTrack workspace window. A live "teammate"
 * cursor clicks through the sidebar, and every item opens its own page
 * (inbox, my issues, search, projects, cycles, AI agent, each team),
 * built from the same primitives the real app uses.
 */
export function MockApp({ className }: { className?: string }) {
  const [page, setPage] = useState("eng");
  const open = useCallback((key: string) => setPage(key), []);
  const view = VIEWS[page] ?? VIEWS.eng;

  return (
    <MockFrame className={className}>
      <MockWindowBar title={`devtrack.malitos.tech/acme/${view.path}`} />
      <div className="flex h-[26rem] text-[0.8125rem]">
        <MockSidebar selected={page} onOpen={open} />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-10 shrink-0 items-center gap-2 border-b px-4">
            <span className="font-medium">{view.title}</span>
            {view.sub ? (
              <>
                <span className="text-muted-foreground/60">/</span>
                <span className="text-muted-foreground">{view.sub}</span>
              </>
            ) : null}
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
          {/* key: each page fades in when the cursor opens it */}
          <div
            key={page}
            className="min-h-0 flex-1 animate-in overflow-hidden fade-in-0 slide-in-from-bottom-1 duration-300 motion-reduce:animate-none"
          >
            {view.body}
          </div>
        </div>
      </div>
    </MockFrame>
  );
}

/* Page contents */

function IssueGroups({ groups }: { groups: typeof HERO_ISSUE_GROUPS }) {
  return (
    <>
      {groups.map((group) => (
        <div key={group.label}>
          <div className="flex h-8 items-center gap-2 border-b bg-muted/40 px-4">
            <StatusIcon status={group.status} className="size-3.5" />
            <span className="text-xs font-medium">{group.label}</span>
            <span className="text-xs text-muted-foreground">{group.issues.length}</span>
          </div>
          {group.issues.map((issue) => (
            <MockIssueRow key={issue.id} issue={issue} />
          ))}
        </div>
      ))}
    </>
  );
}

const ALL_ISSUES = HERO_ISSUE_GROUPS.flatMap((g) => g.issues);

const DESIGN_GROUPS: typeof HERO_ISSUE_GROUPS = [
  {
    status: "in_review",
    label: "In Review",
    issues: [
      { id: "DES-31", title: "Navy dark mode for the board", status: "in_review", priority: "high", assignee: MOCK_PEOPLE.mara, label: MOCK_LABELS.design, due: "Jun 14" },
      { id: "DES-29", title: "Empty states for cycles and projects", status: "in_review", priority: "medium", assignee: MOCK_PEOPLE.ada, label: MOCK_LABELS.design },
    ],
  },
  {
    status: "todo",
    label: "Todo",
    issues: [
      { id: "DES-34", title: "Icon audit: 1.75 px stroke everywhere", status: "todo", priority: "low", assignee: MOCK_PEOPLE.ivy, label: MOCK_LABELS.design },
      { id: "DES-33", title: "Command palette motion spec", status: "todo", priority: "medium", label: MOCK_LABELS.feature, due: "Jun 21" },
    ],
  },
];

const GROWTH_GROUPS: typeof HERO_ISSUE_GROUPS = [
  {
    status: "in_progress",
    label: "In Progress",
    issues: [
      { id: "GRO-12", title: "Onboarding checklist for new workspaces", status: "in_progress", priority: "high", assignee: MOCK_PEOPLE.sam, label: MOCK_LABELS.feature, due: "Jun 17" },
      { id: "GRO-10", title: "Track signup funnel events", status: "in_progress", priority: "medium", assignee: MOCK_PEOPLE.theo, label: MOCK_LABELS.performance },
    ],
  },
  {
    status: "done",
    label: "Done",
    issues: [
      { id: "GRO-8", title: "Pricing page annual toggle", status: "done", priority: "medium", assignee: MOCK_PEOPLE.sam, label: MOCK_LABELS.feature },
    ],
  },
];

function InboxView() {
  const items = [
    { icon: <AtSign className="size-3.5 text-icon" />, who: MOCK_PEOPLE.ada, text: "mentioned you on", id: "ENG-142", when: "2m" },
    { icon: <UserPlus className="size-3.5 text-icon" />, who: MOCK_PEOPLE.jonas, text: "assigned you", id: "ENG-139", when: "18m" },
    { icon: <CircleCheck className="size-3.5 text-status-done" />, who: MOCK_PEOPLE.ivy, text: "moved to Done", id: "ENG-131", when: "1h" },
  ];
  return (
    <div>
      {items.map((n, i) => (
        <div key={n.id} className="flex h-12 items-center gap-3 border-b px-4">
          {i < 2 ? <span className="size-1.5 rounded-full bg-status-done" /> : <span className="size-1.5" />}
          <UserAvatar name={n.who} />
          <div className="min-w-0 flex-1 truncate">
            <span className="font-medium">{n.who.split(" ")[0]}</span>{" "}
            <span className="text-muted-foreground">{n.text}</span>{" "}
            <span className="font-mono text-[0.6875rem] text-muted-foreground">{n.id}</span>
          </div>
          {n.icon}
          <span className="w-8 text-right text-[0.6875rem] text-muted-foreground">{n.when}</span>
        </div>
      ))}
    </div>
  );
}

function SearchView() {
  const hits = ALL_ISSUES.filter((i) => /websocket|search|activity/i.test(i.title));
  return (
    <div className="p-4">
      <div className="flex h-9 items-center gap-2 rounded-lg border px-3 ring-2 ring-ring/40">
        <Search className="size-3.5 text-icon" />
        <span>web</span>
        <span className="h-4 w-px animate-pulse bg-foreground" />
        <Kbd className="ml-auto h-4">Esc</Kbd>
      </div>
      <p className="mt-4 mb-2 text-[0.625rem] font-medium tracking-wider text-muted-foreground uppercase">
        Issues
      </p>
      <div className="overflow-hidden rounded-lg border">
        {hits.map((issue) => (
          <MockIssueRow key={issue.id} issue={issue} />
        ))}
      </div>
    </div>
  );
}

function ProjectsView() {
  const projects = [
    { name: "Launch v1", lead: MOCK_PEOPLE.ada, done: 72, target: "Jun 30" },
    { name: "Navy dark mode", lead: MOCK_PEOPLE.mara, done: 45, target: "Jul 8" },
    { name: "Voice agent", lead: MOCK_PEOPLE.ivy, done: 28, target: "Jul 22" },
    { name: "Billing revamp", lead: MOCK_PEOPLE.sam, done: 90, target: "Jun 19" },
  ];
  return (
    <div>
      {projects.map((p) => (
        <div key={p.name} className="flex h-12 items-center gap-3 border-b px-4">
          <span className="w-36 truncate font-medium">{p.name}</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-status-done" style={{ width: `${p.done}%` }} />
          </div>
          <span className="w-9 text-right font-mono text-[0.6875rem] text-muted-foreground">{p.done}%</span>
          <span className="hidden w-12 text-[0.6875rem] text-muted-foreground sm:block">{p.target}</span>
          <UserAvatar name={p.lead} />
        </div>
      ))}
    </div>
  );
}

function CyclesView() {
  const bars = [3, 5, 6, 9, 11, 12, 15, 18, 20, 22, 25, 27];
  return (
    <div className="p-4">
      <div className="flex items-baseline justify-between">
        <span className="font-medium">Cycle 14</span>
        <span className="text-[0.6875rem] text-muted-foreground">Jun 2 to Jun 16 · 4 days left</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full w-[68%] rounded-full bg-status-done" />
      </div>
      <div className="mt-2 flex gap-4 text-[0.6875rem] text-muted-foreground">
        <span><span className="font-mono text-foreground">27</span> scope</span>
        <span><span className="font-mono text-foreground">18</span> done</span>
        <span><span className="font-mono text-foreground">68%</span> complete</span>
      </div>
      <div className="mt-5 flex h-28 items-end gap-1.5 border-b pb-px">
        {bars.map((h, i) => (
          <div key={i} className="flex-1 rounded-t-sm bg-status-done/80" style={{ height: `${(h / 27) * 100}%` }} />
        ))}
      </div>
      <p className="mt-2 text-[0.6875rem] text-muted-foreground">Completed issues per day</p>
    </div>
  );
}

function AgentView() {
  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="ml-auto max-w-[75%] rounded-lg bg-accent px-3 py-2">
        What should I work on next?
      </div>
      <div className="flex max-w-[85%] gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md border bg-muted">
          <Bot className="size-3.5 text-brand" />
        </span>
        <div className="flex flex-col gap-1.5">
          <span className="inline-flex w-fit items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-0.5 text-[0.6875rem] text-muted-foreground">
            <CircleCheck className="size-3 text-success" /> Reading your issues
          </span>
          <p>
            Start with <span className="font-mono text-[0.75rem]">ENG-142</span>: it is urgent and due
            Jun 16. Then <span className="font-mono text-[0.75rem]">ENG-139</span>, the websocket bug
            two teammates hit this week.
          </p>
        </div>
      </div>
      <div className="mt-auto flex h-9 items-center gap-2 rounded-lg border px-3 text-muted-foreground">
        <Sparkles className="size-3.5 text-brand" />
        Tell DevTrack what to do
      </div>
    </div>
  );
}

const VIEWS: Record<string, { title: string; sub?: string; path: string; body: React.ReactNode }> = {
  inbox: { title: "Inbox", sub: "2 unread", path: "inbox", body: <InboxView /> },
  mine: {
    title: "My issues",
    sub: "Assigned to me",
    path: "my-issues",
    body: (
      <IssueGroups
        groups={[
          {
            status: "in_progress",
            label: "In Progress",
            issues: ALL_ISSUES.filter(
              (i) => i.assignee === MOCK_PEOPLE.ada || i.assignee === MOCK_PEOPLE.jonas
            ),
          },
        ]}
      />
    ),
  },
  search: { title: "Search", path: "search", body: <SearchView /> },
  projects: { title: "Projects", sub: "4 active", path: "projects", body: <ProjectsView /> },
  cycles: { title: "Cycles", sub: "Engineering", path: "cycles", body: <CyclesView /> },
  ai: { title: "AI Agent", path: "ai", body: <AgentView /> },
  eng: { title: "Engineering", sub: "Active issues", path: "team/eng", body: <IssueGroups groups={HERO_ISSUE_GROUPS} /> },
  design: { title: "Design", sub: "Active issues", path: "team/des", body: <IssueGroups groups={DESIGN_GROUPS} /> },
  growth: { title: "Growth", sub: "Active issues", path: "team/gro", body: <IssueGroups groups={GROWTH_GROUPS} /> },
};

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
