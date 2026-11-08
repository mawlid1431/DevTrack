import {
  Ellipsis,
  SignalHigh,
  SignalLow,
  SignalMedium,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { IssuePriority } from "./issue-meta";

/** Issue priority: brand color + shape (urgent, 3, 2 or 1 bars, dots). */
const config: Record<IssuePriority, { icon: typeof Ellipsis; className: string }> = {
  none: { icon: Ellipsis, className: "text-priority-none" },
  urgent: { icon: TriangleAlert, className: "text-priority-urgent" },
  high: { icon: SignalHigh, className: "text-priority-high" },
  medium: { icon: SignalMedium, className: "text-priority-medium" },
  low: { icon: SignalLow, className: "text-priority-low" },
};

export function PriorityIcon({
  priority,
  className,
}: {
  priority: IssuePriority;
  className?: string;
}) {
  const { icon: Icon, className: colorClass } = config[priority];
  return <Icon aria-hidden className={cn("size-4 shrink-0", colorClass, className)} />;
}
