"use client";

import { useState, useRef, useEffect } from "react";
import { useSession, signOut } from "next-auth/react";
import dynamic from "next/dynamic";
const TransferCodeModal = dynamic(
  () => import("@/components/TransferCodeModal").then((m) => m.TransferCodeModal),
  { ssr: false },
);

export function UserMenu() {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const [transferMode, setTransferMode] = useState<"generate" | "redeem" | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  if (!session?.user) {
    return (
      <>
        <div ref={menuRef} className="relative">
          <button
            onClick={() => setOpen(!open)}
            className="w-8 h-8 rounded-full bg-accent-dark text-accent-text text-small font-medium flex items-center justify-center hover:brightness-115 transition-all duration-120 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            aria-label="User menu"
          >
            ?
          </button>
          {open && (
            <div className="absolute right-0 top-full mt-2 w-48 rounded-xl border border-border bg-surface shadow-card py-1 z-50 animate-pop-in">
              <button
                onClick={() => { setTransferMode("generate"); setOpen(false); }}
                className="w-full text-left px-4 py-2 text-small text-ink hover:bg-surface-2 transition-colors duration-120"
              >
                Transfer to another device
              </button>
              <button
                onClick={() => { setTransferMode("redeem"); setOpen(false); }}
                className="w-full text-left px-4 py-2 text-small text-ink hover:bg-surface-2 transition-colors duration-120"
              >
                Have a transfer code?
              </button>
            </div>
          )}
        </div>
        <TransferCodeModal mode={transferMode} onClose={() => setTransferMode(null)} />
      </>
    );
  }

  const initial = session.user.email?.[0]?.toUpperCase() || "?";

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="w-8 h-8 rounded-full bg-accent-dark text-accent-text text-small font-medium flex items-center justify-center hover:brightness-115 transition-all duration-120 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        aria-label="User menu"
      >
        {initial}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-48 rounded-xl border border-border bg-surface shadow-card py-1 z-50 animate-pop-in">
          <div className="px-4 py-2 border-b border-border">
            <p className="text-micro text-ink-soft truncate">{session.user.email}</p>
          </div>
          <a
            href="/saved"
            className="block px-4 py-2 text-small text-ink hover:bg-surface-2 transition-colors duration-120"
            onClick={() => setOpen(false)}
          >
            Saved jobs
          </a>
          <button
            onClick={() => { signOut(); setOpen(false); }}
            className="w-full text-left px-4 py-2 text-small text-ink hover:bg-surface-2 transition-colors duration-120"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
