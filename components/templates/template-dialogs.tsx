"use client";

import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

export function serverMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : "";
  const match = message.match(/Uncaught Error: (.+?)(\n|$)/);
  return match?.[1] ?? (message || fallback);
}

/** Create a project + its starter issues from a project template. */
export function UseProjectTemplateDialog({
  template,
  orgSlug,
  onOpenChange,
}: {
  template: { templateId: string; name: string; issueCount: number } | null;
  orgSlug: string;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const teams = useQuery(api.teams.list, template ? {} : "skip");
  const createFromTemplate = useMutation(api.templates.useProjectTemplate);
  const [teamId, setTeamId] = useState<Id<"teams"> | undefined>();
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const chosenTeam = teamId ?? teams?.[0]?._id;

  const submit = async () => {
    if (!template || !chosenTeam) return;
    setSubmitting(true);
    try {
      const result = await createFromTemplate({
        templateId: template.templateId,
        teamId: chosenTeam,
        projectName: name.trim() || undefined,
      });
      toast.success(`Created ${result.projectName} with ${result.identifiers.length} issues`);
      onOpenChange(false);
      setName("");
      router.push(`/${orgSlug}/projects/${result.projectId}`);
    } catch (error) {
      toast.error(serverMessage(error, "Couldn't create the project"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={template !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Use “{template?.name}”</DialogTitle>
          <DialogDescription>
            Creates a project and {template?.issueCount} starter issues in the team you pick.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="template-project-name">Project name</Label>
            <Input
              id="template-project-name"
              placeholder={template?.name}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Team for the issues</Label>
            <Select value={chosenTeam} onValueChange={(v) => setTeamId(v as Id<"teams">)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={teams?.length === 0 ? "Create a team first" : "Pick a team"} />
              </SelectTrigger>
              <SelectContent>
                {teams?.map((team) => (
                  <SelectItem key={team._id} value={team._id}>
                    {team.name} ({team.key})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || !chosenTeam}>
            Create project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Lines like "Engineering, ENG" or "Bug #ef4444" -> structured values. */
function parseTeams(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, key] = line.split(",").map((part) => part.trim());
      return { name, key: (key ?? name.slice(0, 3)).toUpperCase() };
    });
}

function parseLabels(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(.*?)\s*(#[0-9a-fA-F]{6})?$/);
      return { name: (match?.[1] ?? line).trim(), color: match?.[2] ?? "#6b7280" };
    });
}

/** Save a custom project or workspace template for this workspace. */
export function CreateTemplateDialog({
  open,
  onOpenChange,
  initialKind,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialKind: "project" | "workspace";
}) {
  const create = useMutation(api.templates.create);
  const [kind, setKind] = useState<"project" | "workspace">(initialKind);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [issues, setIssues] = useState("");
  const [teams, setTeams] = useState("");
  const [labels, setLabels] = useState("");
  const [cycleDays, setCycleDays] = useState("14");
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setName("");
    setDescription("");
    setIssues("");
    setTeams("");
    setLabels("");
    setCycleDays("14");
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      if (kind === "project") {
        await create({
          kind,
          name,
          description: description || undefined,
          project: {
            project: {},
            issues: issues
              .split("\n")
              .map((title) => title.trim())
              .filter(Boolean)
              .map((title) => ({ title })),
          },
        });
      } else {
        const days = Number(cycleDays);
        await create({
          kind,
          name,
          description: description || undefined,
          workspace: {
            teams: parseTeams(teams),
            labels: parseLabels(labels),
            cycleLengthDays: cycleDays.trim() && Number.isFinite(days) ? days : undefined,
          },
        });
      }
      toast.success(`Template “${name.trim()}” saved`);
      reset();
      onOpenChange(false);
    } catch (error) {
      toast.error(serverMessage(error, "Couldn't save the template"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New template</DialogTitle>
          <DialogDescription>
            Saved templates are private to this workspace.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Tabs value={kind} onValueChange={(v) => setKind(v as "project" | "workspace")}>
            <TabsList className="h-8">
              <TabsTrigger value="project" className="text-xs">Project</TabsTrigger>
              <TabsTrigger value="workspace" className="text-xs">Workspace</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="template-name">Name</Label>
            <Input id="template-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="template-description">Description</Label>
            <Input
              id="template-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          {kind === "project" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="template-issues">Starter issues (one per line)</Label>
              <Textarea
                id="template-issues"
                className="min-h-32"
                placeholder={"Write the spec\nDesign mockups\nBuild it\nLaunch"}
                value={issues}
                onChange={(e) => setIssues(e.target.value)}
              />
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="template-teams">Teams (one per line: Name, KEY)</Label>
                <Textarea
                  id="template-teams"
                  className="min-h-20"
                  placeholder={"Engineering, ENG\nDesign, DES"}
                  value={teams}
                  onChange={(e) => setTeams(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="template-labels">Labels (one per line: Name #hexcolor)</Label>
                <Textarea
                  id="template-labels"
                  className="min-h-20"
                  placeholder={"Bug #ef4444\nFeature #8b5cf6"}
                  value={labels}
                  onChange={(e) => setLabels(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="template-cycle">First cycle length in days (blank for none)</Label>
                <Input
                  id="template-cycle"
                  inputMode="numeric"
                  value={cycleDays}
                  onChange={(e) => setCycleDays(e.target.value)}
                  className="w-32"
                />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || !name.trim()}>
            Save template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
