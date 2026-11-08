"use client";

import { useOrganizationList, useUser } from "@clerk/nextjs";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { readLastWorkspace } from "@/lib/last-workspace";

/** Clerk's automatic empty first organization ("My Organization"). */
function isAutoCreated(slug: string | null, name: string): boolean {
  return name === "My Organization" || (slug ?? "").startsWith("my-organization");
}

/**
 * Where a signed-in user lands.
 *
 * Returning user: straight into the workspace they used last (their data is
 * there), else one they made themselves, else any workspace they belong to.
 * New user: asked to create their own workspace, named after them by default.
 */
export default function OnboardingPage() {
  const router = useRouter();
  const { user, isLoaded: userLoaded } = useUser();
  const { isLoaded, userMemberships, createOrganization, setActive } =
    useOrganizationList({ userMemberships: { infinite: true } });

  const membershipsReady =
    isLoaded && !userMemberships.isLoading && !userMemberships.hasNextPage;
  const memberships = userMemberships.data ?? [];

  // Returning user: pick the right existing workspace and go.
  const target = (() => {
    if (!membershipsReady || memberships.length === 0) return null;
    const orgs = memberships.map((m) => m.organization);
    const last = readLastWorkspace();
    return (
      orgs.find((o) => o.slug === last) ??
      orgs.find((o) => !isAutoCreated(o.slug, o.name)) ??
      orgs[0]
    );
  })();

  useEffect(() => {
    if (!target || !setActive) return;
    void setActive({ organization: target.id }).then(() => {
      router.replace(`/${target.slug}`);
    });
  }, [target, setActive, router]);

  if (!userLoaded || !membershipsReady || target) {
    return (
      <main className="flex min-h-dvh items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {target ? `Opening ${target.name}…` : "Loading your workspaces…"}
      </main>
    );
  }

  const defaultName = `${user?.firstName || user?.username || "My"}'s Workspace`;
  return (
    <CreateWorkspace
      defaultName={defaultName}
      onCreate={async (name) => {
        const org = await createOrganization!({ name });
        await setActive!({ organization: org.id });
        router.replace(`/${org.slug}`);
      }}
    />
  );
}

function CreateWorkspace({
  defaultName,
  onCreate,
}: {
  defaultName: string;
  onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(defaultName);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setCreating(true);
    setError(null);
    try {
      await onCreate(trimmed);
    } catch (err) {
      setCreating(false);
      setError(err instanceof Error ? err.message : "Couldn't create the workspace. Try again.");
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Create your workspace</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A workspace holds your teams, issues and projects. You can rename it
            or invite people later.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="workspace-name">Workspace name</Label>
          <Input
            id="workspace-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={60}
            autoFocus
            disabled={creating}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <Button type="submit" disabled={creating || !name.trim()}>
          {creating && <Loader2 className="size-4 animate-spin" />}
          {creating ? "Creating…" : "Create workspace"}
        </Button>
      </form>
    </main>
  );
}
