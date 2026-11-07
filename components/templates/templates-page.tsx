"use client";

import { useOrganization } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import {
  Bot,
  FolderKanban,
  LayoutTemplate,
  Loader2,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Id } from "@/convex/_generated/dataModel";
import { FunctionReturnType } from "convex/server";
import {
  CreateTemplateDialog,
  UseProjectTemplateDialog,
  serverMessage,
} from "./template-dialogs";

type Template = FunctionReturnType<typeof api.templates.list>[number];

function TemplateCard({
  template,
  isAdmin,
  onUse,
  onDelete,
}: {
  template: Template;
  isAdmin: boolean;
  onUse: () => void;
  onDelete: () => void;
}) {
  const isProject = template.kind === "project";
  const shown = template.preview.slice(0, 4);
  const more = template.preview.length - shown.length;
  const workspaceLocked = !isProject && !isAdmin;
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted"
          style={template.color ? { color: template.color } : undefined}
        >
          {isProject ? <FolderKanban className="size-4" /> : <Users className="size-4" />}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium">{template.name}</span>
            <Badge variant={template.source === "builtin" ? "secondary" : "outline"} className="shrink-0">
              {template.source === "builtin" ? "Built-in" : "Custom"}
            </Badge>
          </div>
          {template.description && (
            <p className="line-clamp-2 text-xs text-muted-foreground">{template.description}</p>
          )}
        </div>
      </div>

      <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
        {shown.map((line) => (
          <li key={line} className="flex min-w-0 items-center gap-2">
            <span className="size-1 shrink-0 rounded-full bg-muted-foreground/50" />
            <span className="truncate">{line}</span>
          </li>
        ))}
        {more > 0 && <li className="pl-3">+{more} more</li>}
      </ul>

      {!isProject && template.labels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {template.labels.map((label) => (
            <span
              key={label.name}
              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.6875rem]"
            >
              <span className="size-2 rounded-full" style={{ backgroundColor: label.color }} />
              {label.name}
            </span>
          ))}
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <span className="truncate text-[0.6875rem] text-muted-foreground">
          {isProject
            ? `${template.issueCount} issues`
            : `${template.teamCount} teams${template.cycleLengthDays ? ` · ${template.cycleLengthDays}-day cycles` : ""}`}
          {template.createdByName ? ` · by ${template.createdByName}` : ""}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {template.canDelete && (
            <Button
              size="icon"
              variant="ghost"
              className="size-7 text-muted-foreground hover:text-destructive"
              onClick={onDelete}
              aria-label={`Delete ${template.name}`}
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            onClick={onUse}
            disabled={workspaceLocked}
            title={workspaceLocked ? "Only workspace admins can apply workspace templates" : undefined}
          >
            {isProject ? "Use template" : "Apply"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function TemplatesPage({ orgSlug }: { orgSlug: string }) {
  const { membership } = useOrganization();
  const isAdmin = membership?.role === "org:admin";
  const [kind, setKind] = useState<"project" | "workspace">("project");
  const templates = useQuery(api.templates.list, { kind });
  const applyWorkspace = useMutation(api.templates.useWorkspaceTemplate);
  const removeTemplate = useMutation(api.templates.remove);
  const [useProject, setUseProject] = useState<Template | null>(null);
  const [applyTarget, setApplyTarget] = useState<Template | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Template | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const onApplyWorkspace = async () => {
    if (!applyTarget) return;
    try {
      const result = await applyWorkspace({ templateId: applyTarget.templateId });
      const made = [
        result.teamsCreated.length && `${result.teamsCreated.length} teams`,
        result.labelsCreated.length && `${result.labelsCreated.length} labels`,
        result.cyclesCreated && `${result.cyclesCreated} cycles`,
      ].filter(Boolean);
      toast.success(made.length ? `Created ${made.join(", ")}` : "Everything in this template already exists", {
        description: result.skipped.length ? `Skipped: ${result.skipped.join(", ")}` : undefined,
      });
    } catch (error) {
      toast.error(serverMessage(error, "Couldn't apply the template"));
    }
  };

  const onDelete = async () => {
    if (!deleteTarget) return;
    try {
      await removeTemplate({ templateId: deleteTarget.templateId as Id<"templates"> });
      toast.success(`“${deleteTarget.name}” moved to the recycle bin`);
    } catch (error) {
      toast.error(serverMessage(error, "Couldn't delete the template"));
    }
  };

  return (
    <>
      <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-4">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <span className="font-medium">Templates</span>
          {templates !== undefined && (
            <span className="text-xs text-muted-foreground">{templates.length}</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Tabs value={kind} onValueChange={(v) => setKind(v as "project" | "workspace")}>
            <TabsList className="h-7">
              <TabsTrigger value="project" className="h-6 px-2 text-xs">
                Project
              </TabsTrigger>
              <TabsTrigger value="workspace" className="h-6 px-2 text-xs">
                Workspace
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)} aria-label="New template">
            <Plus className="size-4" />
            <span className="hidden sm:inline">New template</span>
          </Button>
        </div>
      </header>

      <div className="flex shrink-0 items-center gap-2 border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
        <Bot className="size-3.5 shrink-0" />
        <span>
          {kind === "project"
            ? "Project templates create a project with starter issues."
            : "Workspace templates add teams, labels and a first cycle to this workspace."}{" "}
          You can also ask the{" "}
          <Link href={`/${orgSlug}/ai`} className="underline underline-offset-2 hover:text-foreground">
            AI agent
          </Link>{" "}
          to create or use templates, or to set up a new workspace.
        </span>
      </div>

      {templates === undefined ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : templates.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <LayoutTemplate className="size-8 text-muted-foreground/50" />
          <p className="text-sm font-medium">No templates yet</p>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="mx-auto grid max-w-7xl grid-cols-1 gap-3 p-4 sm:grid-cols-2 sm:p-6 xl:grid-cols-3 2xl:grid-cols-4">
            {templates.map((template) => (
              <TemplateCard
                key={template.templateId}
                template={template}
                isAdmin={isAdmin}
                onUse={() => (template.kind === "project" ? setUseProject(template) : setApplyTarget(template))}
                onDelete={() => setDeleteTarget(template)}
              />
            ))}
          </div>
        </ScrollArea>
      )}

      <UseProjectTemplateDialog
        template={useProject}
        orgSlug={orgSlug}
        onOpenChange={(open) => !open && setUseProject(null)}
      />
      <CreateTemplateDialog
        key={kind}
        open={createOpen}
        onOpenChange={setCreateOpen}
        initialKind={kind}
      />

      <AlertDialog open={applyTarget !== null} onOpenChange={(open) => !open && setApplyTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply “{applyTarget?.name}” to this workspace?</AlertDialogTitle>
            <AlertDialogDescription>
              Adds {applyTarget?.preview.join(", ") || "no teams"}
              {applyTarget?.labels.length ? `, labels ${applyTarget.labels.map((l) => l.name).join(", ")}` : ""}
              {applyTarget?.cycleLengthDays ? ` and a ${applyTarget.cycleLengthDays}-day first cycle per new team` : ""}.
              Teams and labels that already exist are skipped.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onApplyWorkspace}>Apply template</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteTarget?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The template moves to the recycle bin, where you can restore it for 30 days.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={onDelete}
            >
              Move to recycle bin
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
