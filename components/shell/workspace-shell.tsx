"use client";

import { useOrganizationList } from "@clerk/nextjs";
import { useAction, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { ReactNode, useEffect } from "react";
import { api } from "@/convex/_generated/api";
import { PlanLimitListener } from "@/components/billing/upgrade-prompt";
import { CommandProvider } from "@/components/commands/command-provider";
import { AgentWidget } from "@/components/agent-widget/agent-widget";
import { writeLastWorkspace } from "@/lib/last-workspace";
import { AppSidebar } from "./app-sidebar";
import { FirstVisitTour } from "./first-visit-tour";
import { MobileNav } from "./mobile-nav";

function FullScreenLoader({ label }: { label: string }) {
  return (
    <div className="flex h-dvh items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      {label}
    </div>
  );
}

/**
 * Authenticated workspace shell.
 *
 * 1. Makes sure the Clerk active org matches the org slug in the URL.
 * 2. Waits for the Clerk → Convex webhook sync (user + org docs) before
 *    rendering, so org-scoped queries never throw during onboarding.
 */
export function WorkspaceShell({
  orgSlug,
  children,
}: {
  orgSlug: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const { isLoaded, setActive, userMemberships } = useOrganizationList({
    userMemberships: { infinite: true },
  });

  const targetMembership = userMemberships.data?.find(
    (m) => m.organization.slug === orgSlug
  );
  const needsSwitch = isLoaded && targetMembership !== undefined;

  useEffect(() => {
    if (!isLoaded) {
      return;
    }
    if (targetMembership) {
      void setActive({ organization: targetMembership.organization.id });
    } else if (!userMemberships.isLoading && !userMemberships.hasNextPage) {
      // The user doesn't belong to an org with this slug.
      router.replace("/onboarding");
    }
  }, [
    isLoaded,
    targetMembership,
    userMemberships.isLoading,
    userMemberships.hasNextPage,
    setActive,
    router,
  ]);

  const currentUser = useQuery(api.users.current);
  const currentOrg = useQuery(api.organizations.current);

  // Self-heal: if the webhook sync hasn't landed after a few seconds (missed
  // or never-delivered Clerk webhook), pull our own records from Clerk.
  // Retries a few times because the JWT's active org can lag setActive().
  const ensureSynced = useAction(api.clerkSync.ensureSynced);
  const waitingForSync = currentUser === null || currentOrg === null;
  useEffect(() => {
    if (!waitingForSync) return;
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      ensureSynced({}).catch(() => {
        // Non-fatal: the webhook may still arrive on its own.
      });
      if (attempts >= 15) clearInterval(timer);
    }, 4000);
    return () => clearInterval(timer);
  }, [waitingForSync, ensureSynced]);

  // Remember this workspace so the next sign-in lands here.
  const activeSlug = currentOrg?.slug;
  useEffect(() => {
    if (activeSlug && activeSlug === orgSlug) writeLastWorkspace(orgSlug);
  }, [activeSlug, orgSlug]);

  if (!isLoaded || (needsSwitch && currentOrg === undefined)) {
    return <FullScreenLoader label="Loading workspace…" />;
  }

  // Webhook sync still in flight. Convex queries are reactive, so this
  // resolves by itself within a second or two of first sign-up.
  if (currentUser === null || currentOrg === null) {
    return <FullScreenLoader label="Setting up your workspace…" />;
  }

  if (currentUser === undefined || currentOrg === undefined) {
    return <FullScreenLoader label="Loading workspace…" />;
  }

  if (currentOrg.slug !== orgSlug) {
    return <FullScreenLoader label="Switching organization…" />;
  }

  return (
    <CommandProvider>
      {/* Global upgrade prompt: catches free-plan limit errors toasted anywhere in the workspace. */}
      <PlanLimitListener />
      {/* Phones: top bar + drawer. Tablet and up: fixed sidebar column. */}
      <div data-app-root className="flex h-dvh flex-col overflow-hidden md:flex-row">
        <MobileNav />
        <AppSidebar />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {children}
        </main>
      </div>
      {/* Floating Notion-style AI agent on every workspace screen. */}
      <AgentWidget />
      <FirstVisitTour />
    </CommandProvider>
  );
}
