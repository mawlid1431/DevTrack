import { SignIn } from "@clerk/nextjs";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";

export default function SignInPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-muted px-4 dark:bg-background py-10">
      <Link href="/" aria-label="DevTrack home">
        <Logo size={40} title="" />
      </Link>
      <SignIn />
    </main>
  );
}
