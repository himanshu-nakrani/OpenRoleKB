"use client";

import { useState, useRef, useEffect } from "react";
import { signIn } from "next-auth/react";

interface SignInModalProps {
  open: boolean;
  onClose: () => void;
}

export function SignInModal({ open, onClose }: SignInModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  // Sync the dialog element with the open prop — this is an external system
  // (the DOM <dialog>), not React state, so a setState-free effect is fine.
  useEffect(() => {
    if (open) {
      dialogRef.current?.showModal();
    } else {
      dialogRef.current?.close();
    }
  }, [open]);

  function handleClose() {
    setEmail("");
    setSent(false);
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    await signIn("resend", { email, redirect: false });
    setSubmitting(false);
    setSent(true);
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={handleClose}
      className="backdrop:bg-black/60 rounded-2xl border border-border-strong bg-surface p-0 max-w-md w-[90vw] shadow-card open:animate-fade-in"
    >
      <div className="p-6">
        {sent ? (
          <div className="text-center py-4">
            <p className="text-body font-medium">Check your email</p>
            <p className="text-small text-ink-soft mt-2">
              We sent a magic link to <strong>{email}</strong>. Click it to sign in.
            </p>
            <button
              onClick={handleClose}
              className="mt-4 text-accent text-small hover:underline"
            >
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <h3 className="text-h2 font-medium mb-4">Sign in</h3>
            <p className="text-small text-ink-soft mb-4">
              Enter your email to receive a magic link.
            </p>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              className="w-full h-11 px-4 rounded-full border border-border bg-surface text-small text-ink placeholder:text-muted focus-visible:outline-none focus-visible:border-border-strong focus-visible:ring-1 focus-visible:ring-accent/40 transition-all duration-120"
            />
            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={handleClose}
                className="flex-1 px-4 py-2 rounded-full border border-border text-small text-ink-soft hover:bg-surface-2 transition-all duration-120"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!email.trim() || submitting}
                className="flex-1 px-4 py-2 rounded-full bg-accent-dark text-accent-text text-small font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 active:brightness-90 active:scale-[0.98] transition-all duration-120"
              >
                {submitting ? "Sending…" : "Send magic link"}
              </button>
            </div>
          </form>
        )}
      </div>
    </dialog>
  );
}
