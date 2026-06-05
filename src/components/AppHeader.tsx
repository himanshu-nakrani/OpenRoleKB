"use client";

import { useState } from "react";
import Link from "next/link";
import { UserMenu } from "@/components/UserMenu";
import dynamic from "next/dynamic";
const SignInModal = dynamic(
  () => import("@/components/SignInModal").then((m) => m.SignInModal),
  { ssr: false },
);
import { ThemeToggle } from "@/components/ThemeToggle";
import { useMergeOnSignIn } from "@/hooks/useMergeOnSignIn";
import { useSession } from "next-auth/react";

export function AppHeader() {
  const [signInOpen, setSignInOpen] = useState(false);
  useMergeOnSignIn();
  const { data: session } = useSession();

  return (
    <header className="sticky top-0 z-40 backdrop-blur-xl bg-bg/70 border-b border-border">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link
          href="/"
          className="flex items-center gap-2.5 text-ink no-underline hover:opacity-80 transition-all duration-120"
        >
          <span className="w-2 h-2 rounded-full bg-accent ring-1 ring-accent-dark/20" />
          <span className="text-h1 font-medium tracking-tight font-display-opsz-h1">
            OpenRole<span className="text-accent">KB</span>
          </span>
        </Link>
        <div className="flex items-center gap-3">
          <UserMenu />
          {!session && (
            <button
              onClick={() => setSignInOpen(true)}
              className="px-4 py-1.5 text-micro rounded-full border border-border text-muted hover:text-ink hover:border-accent/40 hover:bg-surface-2 active:bg-surface-3 active:scale-[0.98] transition-all duration-120"
            >
              Sign in
            </button>
          )}
          <ThemeToggle />
        </div>
      </div>
      <SignInModal open={signInOpen} onClose={() => setSignInOpen(false)} />
    </header>
  );
}
