import Link from "next/link";
import { Show } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { BrandName, Logo } from "@/components/brand/logo";

/**
 * Marketing layout, Track F owns the landing page content, Track E owns
 * /pricing. Keep this nav minimal; don't add app logic here.
 */
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-2 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <Logo size={24} title="" />
            <BrandName />
          </Link>
          <nav className="flex items-center gap-1 sm:gap-2">
            {/* Hidden only on the narrowest phones (<360px); the hero's
                "View pricing" button still links there. */}
            <Button variant="ghost" size="sm" className="max-[359px]:hidden" asChild>
              <Link href="/pricing">Pricing</Link>
            </Button>
            <Show when="signed-out">
              <Button variant="ghost" size="sm" asChild>
                <Link href="/sign-in">Log in</Link>
              </Button>
              <Button size="sm" asChild>
                <Link href="/sign-up">Sign up</Link>
              </Button>
            </Show>
            <Show when="signed-in">
              <Button size="sm" asChild>
                <Link href="/onboarding">Open app</Link>
              </Button>
            </Show>
          </nav>
        </div>
      </header>
      {/* overflow-x-clip: decorative glows never cause sideways scroll. */}
      <div className="flex-1 overflow-x-clip">{children}</div>
    </div>
  );
}
