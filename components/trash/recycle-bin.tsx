"use client";

import { useMutation, useQuery } from "convex/react";
import {
  Bookmark,
  CircleDot,
  FolderKanban,
  LayoutTemplate,
  Loader2,
  MessageSquare,
  Paperclip,
  RefreshCcw,
  RotateCcw,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Doc, Id } from "@/convex/_generated/dataModel";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const KIND: Record<Doc<"trash">["kind"], { icon: LucideIcon; label: string }> = {
  issue: { icon: CircleDot, label: "Issue" },
  project: { icon: FolderKanban, label: "Project" },
  cycle: { icon: RefreshCcw, label: "Cycle" },
  comment: { icon: MessageSquare, label: "Comment" },
  attachment: { icon: Paperclip, label: "Attachment" },
  view: { icon: Bookmark, label: "Saved view" },
  template: { icon: LayoutTemplate, label: "Template" },
};

/** Current time rounded to the minute; re-renders once a minute. */
function subscribeMinute(onTick: () => void): () => void {
  const id = setInterval(onTick, 60_000);
  return () => clearInterval(id);
}
function useNow(): number {
  return useSyncExternalStore(
    subscribeMinute,
    () => Math.floor(Date.now() / 60_000) * 60_000,
    () => 0
  );
}

function timeAgo(ms: number, now: number): string {
  const minutes = Math.round((now - ms) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function errorText(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : "";
  // Convex prefixes server errors with request metadata; keep the human part.
  const match = message.match(/Uncaught Error: (.+?)(\n|$)/);
  return match?.[1] ?? (message || fallback);
}

export function RecycleBin({ orgSlug }: { orgSlug: string }) {
  const router = useRouter();
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const data = useQuery(api.trash.list, { scope });
  const restore = useMutation(api.trash.restore);
  const deleteForever = useMutation(api.trash.deleteForever);
  const empty = useMutation(api.trash.empty);
  const [busy, setBusy] = useState<Id<"trash"> | "empty" | null>(null);
  const now = useNow();

  const onRestore = async (trashId: Id<"trash">, label: string) => {
    setBusy(trashId);
    try {
      const result = await restore({ trashId });
      toast.success(`Restored ${label}`, result.path
        ? { action: { label: "Open", onClick: () => router.push(`/${orgSlug}${result.path}`) } }
        : undefined);
    } catch (error) {
      toast.error(errorText(error, "Couldn't restore this item"));
    } finally {
      setBusy(null);
    }
  };

  const onDeleteForever = async (trashId: Id<"trash">) => {
    setBusy(trashId);
    try {
      await deleteForever({ trashId });
      toast.success("Deleted forever");
    } catch (error) {
      toast.error(errorText(error, "Couldn't delete this item"));
    } finally {
      setBusy(null);
    }
  };

  const onEmpty = async () => {
    setBusy("empty");
    try {
      let total = 0;
      for (let i = 0; i < 50; i++) {
        const { deleted, remaining } = await empty({});
        total += deleted;
        if (!remaining) break;
      }
      toast.success(`Recycle bin emptied (${total} item${total === 1 ? "" : "s"})`);
    } catch (error) {
      toast.error(errorText(error, "Couldn't empty the recycle bin"));
    } finally {
      setBusy(null);
    }
  };

  const items = data?.items;

  return (
    <>
      <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-4">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <span className="font-medium">Recycle bin</span>
          {items !== undefined && (
            <span className="text-xs text-muted-foreground">{items.length}</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {data?.isAdmin && (
            <Tabs value={scope} onValueChange={(value) => setScope(value as "mine" | "all")}>
              <TabsList className="h-7">
                <TabsTrigger value="mine" className="h-6 px-2 text-xs">
                  Mine
                </TabsTrigger>
                <TabsTrigger value="all" className="h-6 px-2 text-xs">
                  Everyone
                </TabsTrigger>
              </TabsList>
            </Tabs>
          )}
          {data?.isAdmin && (items?.length ?? 0) > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="outline" disabled={busy === "empty"} aria-label="Empty recycle bin">
                  <Trash2 className="size-4" />
                  <span className="hidden sm:inline">Empty bin</span>
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Empty the recycle bin?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Everything deleted in this workspace, by every member, is
                    removed for good, including attached files. This can&apos;t
                    be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-white hover:bg-destructive/90"
                    onClick={onEmpty}
                  >
                    Empty bin
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </header>

      <div className="shrink-0 border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
        Deleted items stay here for 30 days, then they&apos;re removed for good.{" "}
        {data?.isAdmin
          ? "As an admin you can restore anything deleted in this workspace."
          : "You can see and restore what you deleted."}
      </div>

      {items === undefined ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
          <Trash2 className="size-8 text-muted-foreground/50" />
          <div>
            <p className="text-sm font-medium">Recycle bin is empty</p>
            <p className="text-xs text-muted-foreground">
              Deleted issues, projects, cycles, comments, files, views and templates show up here.
            </p>
          </div>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="hidden h-8 items-center gap-3 border-b bg-muted/50 px-4 text-xs text-muted-foreground sm:flex">
            <span className="flex-1 pl-7">Item</span>
            <span className="hidden w-40 md:block">Deleted</span>
            <span className="hidden w-24 lg:block">Expires</span>
            <span className="w-[8.5rem] text-right">Actions</span>
          </div>
          {items.map((item) => {
            const kind = KIND[item.kind];
            const Icon = kind.icon;
            const daysLeft = Math.max(0, Math.ceil((item.expiresAt - now) / 86_400_000));
            const working = busy === item.trashId;
            return (
              <div
                key={item.trashId}
                className="flex min-h-11 items-center gap-3 border-b px-4 py-1.5 text-sm hover:bg-accent/40"
              >
                <Icon className="size-4 shrink-0 text-muted-foreground" aria-label={kind.label} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{item.label}</span>
                  <span className="truncate text-xs text-muted-foreground md:hidden">
                    {kind.label} · {item.deletedByMe ? "you" : item.deletedByName} · {timeAgo(item.deletedAt, now)} · {daysLeft}d left
                  </span>
                </div>
                <span className="hidden w-40 truncate text-xs text-muted-foreground md:block">
                  {item.deletedByMe ? "You" : item.deletedByName} · {timeAgo(item.deletedAt, now)}
                </span>
                <span className="hidden w-24 text-xs text-muted-foreground lg:block">
                  in {daysLeft} day{daysLeft === 1 ? "" : "s"}
                </span>
                <div className="flex shrink-0 items-center justify-end gap-1 sm:w-[8.5rem]">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 px-2"
                    disabled={working}
                    onClick={() => onRestore(item.trashId, item.label)}
                    aria-label={`Restore ${item.label}`}
                  >
                    {working ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
                    <span className="hidden sm:inline">Restore</span>
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 text-muted-foreground hover:text-destructive"
                        disabled={working}
                        aria-label={`Delete ${item.label} forever`}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete forever?</AlertDialogTitle>
                        <AlertDialogDescription>
                          &ldquo;{item.label}&rdquo; will be removed permanently, including any
                          attached files. This can&apos;t be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-white hover:bg-destructive/90"
                          onClick={() => onDeleteForever(item.trashId)}
                        >
                          Delete forever
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            );
          })}
        </ScrollArea>
      )}
    </>
  );
}
