"use client";

import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { shadcn } from "@clerk/ui/themes";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { ThemeProvider } from "next-themes";
import { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
    >
      <ClerkProvider
        appearance={{
          theme: shadcn,
          // Brand: white inputs with a navy border (Navy 800 fill in dark).
          variables: { colorInput: "var(--input-fill)" },
          // Green TEXT uses Green 700 on light / Green 400 on navy (contrast rule 3).
          elements: {
            footerActionLink: { color: "var(--brand-text)" },
            formFieldAction: { color: "var(--brand-text)" },
            formResendCodeLink: { color: "var(--brand-text)" },
            identityPreviewEditButton: { color: "var(--brand-text)" },
            alternativeMethodsBlockButton: { color: "var(--brand-text)" },
          },
        }}
      >
        <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
          {/* Radix tooltips require a root provider; the ui/tooltip primitive
              does not self-wrap, so every bare <Tooltip> depends on this. */}
          <TooltipProvider>{children}</TooltipProvider>
        </ConvexProviderWithClerk>
      </ClerkProvider>
    </ThemeProvider>
  );
}
