"use client";

import { useQuery } from "convex/react";
import { Loader2, Plus } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { CreateTeamDialog } from "@/components/teams/create-team-dialog";

/**
 * Workspace home: opens the first team's issues, or shows a simple empty
 * state with one clear next step (create a team).
 */
export default function WorkspaceHomePage() {
  const params = useParams<{ orgSlug: string }>();
  const router = useRouter();
  const teams = useQuery(api.teams.list);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    if (teams && teams.length > 0) {
      router.replace(`/${params.orgSlug}/team/${teams[0]._id}`);
    }
  }, [teams, router, params.orgSlug]);

  if (teams === undefined || teams.length > 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
      <h2 className="text-lg font-medium">Welcome to DevTrack</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        Create your first team to start tracking issues. You can also ask the
        AI agent to set everything up for you.
      </p>
      <Button size="sm" className="mt-3" onClick={() => setCreateOpen(true)}>
        <Plus className="size-4" />
        Create team
      </Button>
      <CreateTeamDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
