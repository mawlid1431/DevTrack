"use client";

import { Menu, Search } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { useCommands } from "@/components/commands/command-provider";
import { AppSidebar } from "./app-sidebar";

/**
 * Phone-sized top bar (hidden from `md` up). Opens the full workspace
 * sidebar in a slide-in drawer and closes it again after navigation.
 */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const { openPalette } = useCommands();

  // Close the drawer whenever the route changes (a nav link was tapped).
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  // Close if the viewport grows past the mobile breakpoint (rotation, resize).
  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)");
    const onChange = () => query.matches && setOpen(false);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b bg-sidebar px-2 md:hidden">
      <Button
        variant="ghost"
        size="icon"
        className="size-9"
        aria-label="Open navigation"
        onClick={() => setOpen(true)}
      >
        <Menu className="size-5" />
      </Button>
      <span className="text-sm font-semibold">DevTrack</span>
      <Button
        variant="ghost"
        size="icon"
        className="ml-auto size-9"
        aria-label="Search and commands"
        onClick={openPalette}
      >
        <Search className="size-4" />
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="left"
          className="w-[min(18rem,85vw)] gap-0 p-0"
        >
          <SheetTitle className="sr-only">Workspace navigation</SheetTitle>
          <SheetDescription className="sr-only">
            Teams, projects, cycles and the AI agent
          </SheetDescription>
          <AppSidebar variant="drawer" />
        </SheetContent>
      </Sheet>
    </div>
  );
}
