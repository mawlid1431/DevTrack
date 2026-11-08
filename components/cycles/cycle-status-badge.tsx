import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CYCLE_STATUS_LABELS, CycleStatus } from "./cycle-meta";

const styles: Record<CycleStatus, string> = {
  current: "border-success-fill/40 text-success",
  upcoming: "border-info-fill/40 text-info",
  completed: "border-border text-muted-foreground",
};

export function CycleStatusBadge({
  status,
  className,
}: {
  status: CycleStatus;
  className?: string;
}) {
  return (
    <Badge variant="outline" className={cn(styles[status], className)}>
      {CYCLE_STATUS_LABELS[status]}
    </Badge>
  );
}
