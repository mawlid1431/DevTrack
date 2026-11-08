"use client";

import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import {
  Bot,
  ChevronRight,
  FolderKanban,
  Home,
  LayoutTemplate,
  Plus,
  RefreshCcw,
  Search,
  SquarePen,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { ReactNode, useState } from "react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCommands } from "@/components/commands/command-provider";
import { CreateTeamDialog } from "@/components/teams/create-team-dialog";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./theme-toggle";

/**
 * Every sidebar row shares one geometry so icons and labels line up on a
 * single left edge: 28px tall, 8px inner padding, 16px icon slot, 8px gap.
 */
const ROW =
  "flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";
const ICON_SLOT = "flex size-4 shrink-0 items-center justify-center [&>svg]:size-4 [&>svg]:opacity-70";

function NavLink({
  href,
  icon,
  children,
  exact = false,
}: {
  href: string;
  icon: ReactNode;
  children: ReactNode;
  exact?: boolean;
}) {
  const pathname = usePathname();
  const active = exact
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        ROW,
        active && "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
      )}
    >
      <span className={ICON_SLOT}>{icon}</span>
      <span className="truncate">{children}</span>
    </Link>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-2 pb-1 pt-4 text-xs font-medium text-muted-foreground">
      {children}
    </div>
  );
}

/**
 * Workspace navigation. Rendered as a fixed column on tablets and up
 * (`variant="desktop"`, hidden below `md`) and inside the mobile drawer
 * (`variant="drawer"`, see mobile-nav.tsx) — same content, one source.
 */
export function AppSidebar({
  variant = "desktop",
}: {
  variant?: "desktop" | "drawer";
}) {
  const params = useParams<{ orgSlug: string }>();
  const teams = useQuery(api.teams.list);
  const { openCreateIssue, openPalette } = useCommands();
  const [createTeamOpen, setCreateTeamOpen] = useState(false);
  const base = `/${params.orgSlug}`;

  return (
    <aside
      className={cn(
        "flex-col bg-sidebar text-sidebar-foreground",
        variant === "desktop"
          ? "hidden w-60 shrink-0 border-r border-sidebar-border md:flex"
          : "flex h-full w-full"
      )}
    >
      {/* Workspace switcher + new issue */}
      <div className="flex h-12 shrink-0 items-center justify-between gap-1 px-2">
        <div className="min-w-0 flex-1">
          <OrganizationSwitcher
            hidePersonal
            afterSelectOrganizationUrl="/:slug"
            afterCreateOrganizationUrl="/:slug"
            appearance={{
              elements: {
                rootBox: "w-full min-w-0",
                organizationSwitcherTrigger:
                  "w-full max-w-full justify-start rounded-md px-2 py-1 hover:bg-sidebar-accent focus:shadow-none",
              },
            }}
          />
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0 text-sidebar-foreground hover:bg-sidebar-accent"
              onClick={openCreateIssue}
              aria-label="New issue"
            >
              <SquarePen className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">New issue (C)</TooltipContent>
        </Tooltip>
      </div>

      {/* Radix ScrollArea wraps children in a `display: table` div, which
          breaks `truncate`; force it back to block so long names ellipsize. */}
      <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block">
        <div className="flex flex-col px-2 pb-4">
          <nav className="flex flex-col gap-px">
            <button type="button" onClick={openPalette} className={ROW}>
              <span className={ICON_SLOT}>
                <Search />
              </span>
              <span className="truncate">Search</span>
              <kbd className="ml-auto rounded px-1 font-mono text-[0.625rem] text-muted-foreground">
                ⌘K
              </kbd>
            </button>
            <NavLink href={`${base}/ai`} icon={<Bot />}>
              AI Agent
            </NavLink>
            <NavLink href={base} exact icon={<Home />}>
              Workspace
            </NavLink>
          </nav>

          <SectionLabel>Workspace</SectionLabel>
          <nav className="flex flex-col gap-px">
            <NavLink href={`${base}/projects`} icon={<FolderKanban />}>
              Projects
            </NavLink>
            <NavLink href={`${base}/cycles`} icon={<RefreshCcw />}>
              Cycles
            </NavLink>
            <NavLink href={`${base}/templates`} icon={<LayoutTemplate />}>
              Templates
            </NavLink>
          </nav>

          <Collapsible defaultOpen>
            <div className="group/teams flex items-center justify-between pr-1 pt-4">
              <CollapsibleTrigger className="group/trigger flex h-6 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
                Teams
                <ChevronRight className="size-3 transition-transform group-data-[state=open]/trigger:rotate-90" />
              </CollapsibleTrigger>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 text-muted-foreground opacity-100 hover:bg-sidebar-accent md:opacity-0 md:group-hover/teams:opacity-100 md:focus-visible:opacity-100"
                    onClick={() => setCreateTeamOpen(true)}
                    aria-label="Create team"
                  >
                    <Plus className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">Create team</TooltipContent>
              </Tooltip>
            </div>
            <CollapsibleContent className="flex flex-col gap-px pt-1">
              {teams?.map((team) => (
                <NavLink
                  key={team._id}
                  href={`${base}/team/${team._id}`}
                  icon={
                    <span className="flex size-4 items-center justify-center rounded bg-primary/15 text-[0.5rem] font-semibold leading-none text-primary">
                      {team.key.slice(0, 2)}
                    </span>
                  }
                >
                  {team.name}
                </NavLink>
              ))}
              {teams?.length === 0 && (
                <button
                  type="button"
                  onClick={() => setCreateTeamOpen(true)}
                  className={cn(ROW, "text-muted-foreground")}
                >
                  <span className={ICON_SLOT}>
                    <Plus />
                  </span>
                  <span className="truncate">Create your first team</span>
                </button>
              )}
            </CollapsibleContent>
          </Collapsible>

          <nav className="mt-4 flex flex-col gap-px">
            <NavLink href={`${base}/trash`} icon={<Trash2 />}>
              Recycle bin
            </NavLink>
          </nav>
        </div>
      </ScrollArea>

      <div className="flex h-12 shrink-0 items-center justify-between border-t border-sidebar-border px-3">
        <UserButton />
        <ThemeToggle />
      </div>

      <CreateTeamDialog open={createTeamOpen} onOpenChange={setCreateTeamOpen} />
    </aside>
  );
}
