"use client";

import { CreditCard, Users } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const SETTINGS_PAGES = [
  { label: "Billing", segment: "billing", icon: CreditCard },
  { label: "Members", segment: "members", icon: Users },
] as const;

/** Left-hand navigation for the workspace settings section. */
export function SettingsNav() {
  const params = useParams<{ orgSlug: string }>();
  const pathname = usePathname();
  const base = `/${params.orgSlug}/settings`;

  return (
    <nav className="flex shrink-0 gap-0.5 overflow-x-auto border-b p-2 md:w-44 md:flex-col md:overflow-visible md:border-r md:border-b-0 md:p-3">
      <span className="hidden px-2 pb-1 text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase md:block">
        Workspace
      </span>
      {SETTINGS_PAGES.map(({ label, segment, icon: Icon }) => {
        const href = `${base}/${segment}`;
        const active = pathname.startsWith(href);
        return (
          <Link
            key={segment}
            href={href}
            className={cn(
              "flex h-7 shrink-0 items-center gap-2 rounded-md px-2 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
              active && "bg-accent text-foreground"
            )}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
