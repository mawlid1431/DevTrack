"use client";

import { useMutation } from "convex/react";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
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

/**
 * Moves an issue to the recycle bin (restorable for 30 days) and offers an
 * immediate Undo in the toast.
 */
export function DeleteIssueButton({
  issueId,
  identifier,
  orgSlug,
  backHref,
}: {
  issueId: Id<"issues">;
  identifier: string;
  orgSlug: string;
  backHref: string;
}) {
  const router = useRouter();
  const removeIssue = useMutation(api.issues.remove);
  const restore = useMutation(api.trash.restore);
  const [pending, setPending] = useState(false);

  const onConfirm = async () => {
    setPending(true);
    try {
      const trashId = await removeIssue({ issueId });
      router.push(backHref);
      toast.success(`${identifier} moved to the recycle bin`, {
        action: {
          label: "Undo",
          onClick: () => {
            restore({ trashId })
              .then((result) => {
                toast.success(`${identifier} restored`);
                if (result.path) router.push(`/${orgSlug}${result.path}`);
              })
              .catch((error: unknown) =>
                toast.error(error instanceof Error ? error.message : "Couldn't restore the issue")
              );
          },
        },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't delete the issue");
      setPending(false);
    }
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:text-destructive"
          aria-label={`Delete ${identifier}`}
        >
          <Trash2 className="size-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {identifier}?</AlertDialogTitle>
          <AlertDialogDescription>
            The issue, its comments and attachments move to the recycle bin.
            You can restore them for 30 days.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-white hover:bg-destructive/90"
            disabled={pending}
            onClick={onConfirm}
          >
            Move to recycle bin
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
