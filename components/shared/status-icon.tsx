import {
  Circle,
  CircleCheck,
  CircleDashed,
  CircleEllipsis,
  CircleX,
  Contrast,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { IssueStatus } from "./issue-meta";

/**
 * Issue status: brand color + a distinct shape, so status never relies on
 * color alone (guidelines, Contrast & visibility rule 6).
 */
const config: Record<IssueStatus, { icon: typeof Circle; className: string }> = {
  backlog: { icon: CircleDashed, className: "text-status-backlog" },
  todo: { icon: Circle, className: "text-status-todo" },
  in_progress: { icon: Contrast, className: "text-status-in-progress" },
  in_review: { icon: CircleEllipsis, className: "text-status-in-review" },
  done: { icon: CircleCheck, className: "text-status-done" },
  canceled: { icon: CircleX, className: "text-status-canceled" },
};

export function StatusIcon({
  status,
  className,
}: {
  status: IssueStatus;
  className?: string;
}) {
  const { icon: Icon, className: colorClass } = config[status];
  return <Icon aria-hidden className={cn("size-4 shrink-0", colorClass, className)} />;
}
