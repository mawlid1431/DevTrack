"use client";

import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import {
  Bot,
  ChevronRight,
  FolderKanban,
  Home,
  LayoutTemplate,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCcw,
  Search,
  SquarePen,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { ReactNode, createContext, useContext, useEffect, useState } from "react";
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
 * Collapsed, rows become 32px icon squares centred in a 56px rail.
 */
const ROW =
  "flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";
const ROW_COLLAPSED = "h-8 w-8 justify-center gap-0 px-0 mx-auto";
const ICON_SLOT = "flex size-4 shrink-0 items-center justify-center [&>svg]:size-4 [&>svg]:opacity-70";

const COLLAPSE_KEY = "devtrack:sidebar-collapsed";
const CollapsedContext = createContext(false);

/** A row that shows a tooltip with its label when the sidebar is collapsed. */
function RailTooltip({ label, children }: { label: string; children: ReactNode }) {
  const collapsed = useContext(CollapsedContext);
  if (!collapsed) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function NavLink({
  href,
  icon,
  label,
  exact = false,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  exact?: boolean;
}) {
  const collapsed = useContext(CollapsedContext);
  const pathname = usePathname();
  const active = exact
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <RailTooltip label={label}>
      <Link
        href={href}
        aria-label={collapsed ? label : undefined}
        aria-current={active ? "page" : undefined}
        className={cn(
          ROW,
          collapsed && ROW_COLLAPSED,
          active && "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
        )}
      >
        <span className={ICON_SLOT}>{icon}</span>
        {!collapsed && <span className="truncate">{label}</span>}
      </Link>
    </RailTooltip>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  const collapsed = useContext(CollapsedContext);
  if (collapsed) return <div className="mx-auto my-3 h-px w-6 bg-sidebar-border" />;
  return (
    <div className="px-2 pb-1 pt-4 text-xs font-medium text-muted-foreground">
      {children}
    </div>
  );
}

/**
 * Workspace navigation. Rendered as a fixed column on tablets and up
 * (`variant="desktop"`, hidden below `md`) and inside the mobile drawer
 * (`variant="drawer"`, see mobile-nav.tsx): same content, one source.
 * On desktop it collapses to an icon rail (button or Ctrl + \).
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
  const [collapsedPref, setCollapsedPref] = useState(false);
  const base = `/${params.orgSlug}`;
  const collapsed = variant === "desktop" && collapsedPref;

  useEffect(() => {
    if (variant !== "desktop") return;
    try {
      // Restore the saved preference after mount (browser storage).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCollapsedPref(localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      // Storage blocked: start expanded.
    }
  }, [variant]);

  const toggle = () => {
    setCollapsedPref((value) => {
      const next = !value;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        // Not saved; still toggles for this visit.
      }
      return next;
    });
  };

  useEffect(() => {
    if (variant !== "desktop") return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "\\") {
        event.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [variant]);

  const collapseButton =
    variant === "desktop" ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-sidebar-foreground hover:bg-sidebar-accent"
            onClick={toggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            data-tour="sidebar-toggle"
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">
          {collapsed ? "Expand sidebar" : "Collapse sidebar"} (Ctrl+\)
        </TooltipContent>
      </Tooltip>
    ) : null;

  return (
    <CollapsedContext.Provider value={collapsed}>
      <aside
        data-tour="sidebar"
        className={cn(
          "flex-col bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out motion-reduce:transition-none",
          variant === "desktop"
            ? cn("hidden shrink-0 border-r border-sidebar-border md:flex", collapsed ? "w-14" : "w-60")
            : "flex h-full w-full"
        )}
      >
        {/* Header: workspace switcher, new issue, collapse */}
        {collapsed ? (
          <div className="flex shrink-0 flex-col items-center gap-1 py-2">
            {collapseButton}
          </div>
        ) : (
          <div className="flex h-12 shrink-0 items-center justify-between gap-1 px-2">
            <div className="min-w-0 flex-1" data-tour="workspace-switcher">
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
            {collapseButton}
          </div>
        )}

        {/* Radix ScrollArea wraps children in a `display: table` div, which
            breaks `truncate`; force it back to block so long names ellipsize. */}
        <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block">
          <div className={cn("flex flex-col pb-4", collapsed ? "px-0" : "px-2")}>
            <nav className="flex flex-col gap-px">
              <RailTooltip label="New issue (C)">
                <button
                  type="button"
                  onClick={openCreateIssue}
                  aria-label="New issue"
                  data-tour="new-issue"
                  className={cn(ROW, collapsed && ROW_COLLAPSED)}
                >
                  <span className={ICON_SLOT}>
                    <SquarePen />
                  </span>
                  {!collapsed && <span className="truncate">New issue</span>}
                </button>
              </RailTooltip>
              <RailTooltip label="Search (Ctrl+K)">
                <button
                  type="button"
                  onClick={openPalette}
                  aria-label="Search"
                  data-tour="search"
                  className={cn(ROW, collapsed && ROW_COLLAPSED)}
                >
                  <span className={ICON_SLOT}>
                    <Search />
                  </span>
                  {!collapsed && (
                    <>
                      <span className="truncate">Search</span>
                      <kbd className="ml-auto rounded px-1 font-mono text-[0.625rem] text-muted-foreground">
                        ⌘K
                      </kbd>
                    </>
                  )}
                </button>
              </RailTooltip>
              <NavLink href={`${base}/ai`} icon={<Bot />} label="AI Agent" />
              <NavLink href={base} exact icon={<Home />} label="Home" />
            </nav>

            <SectionLabel>Workspace</SectionLabel>
            <nav className="flex flex-col gap-px" data-tour="workspace-nav">
              <NavLink href={`${base}/projects`} icon={<FolderKanban />} label="Projects" />
              <NavLink href={`${base}/cycles`} icon={<RefreshCcw />} label="Cycles" />
              <NavLink href={`${base}/templates`} icon={<LayoutTemplate />} label="Templates" />
            </nav>

            {collapsed ? (
              <>
                <SectionLabel>Teams</SectionLabel>
                <nav className="flex flex-col gap-px">
                  {teams?.map((team) => (
                    <NavLink
                      key={team._id}
                      href={`${base}/team/${team._id}`}
                      label={team.name}
                      icon={
                        <span className="flex size-4 items-center justify-center rounded bg-primary/15 text-[0.5rem] font-semibold leading-none text-primary">
                          {team.key.slice(0, 2)}
                        </span>
                      }
                    />
                  ))}
                  <RailTooltip label="Create team">
                    <button
                      type="button"
                      onClick={() => setCreateTeamOpen(true)}
                      aria-label="Create team"
                      className={cn(ROW, ROW_COLLAPSED, "text-muted-foreground")}
                    >
                      <span className={ICON_SLOT}>
                        <Plus />
                      </span>
                    </button>
                  </RailTooltip>
                </nav>
              </>
            ) : (
              <Collapsible defaultOpen data-tour="teams">
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
                      label={team.name}
                      icon={
                        <span className="flex size-4 items-center justify-center rounded bg-primary/15 text-[0.5rem] font-semibold leading-none text-primary">
                          {team.key.slice(0, 2)}
                        </span>
                      }
                    />
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
            )}

            <nav className={cn("flex flex-col gap-px", collapsed ? "mt-3" : "mt-4")}>
              <NavLink href={`${base}/trash`} icon={<Trash2 />} label="Recycle bin" />
            </nav>
          </div>
        </ScrollArea>

        <div
          className={cn(
            "flex shrink-0 border-t border-sidebar-border",
            collapsed ? "flex-col items-center gap-2 py-3" : "h-12 items-center justify-between px-3"
          )}
        >
          <UserButton />
          <ThemeToggle />
        </div>

        <CreateTeamDialog open={createTeamOpen} onOpenChange={setCreateTeamOpen} />
      </aside>
    </CollapsedContext.Provider>
  );
}
