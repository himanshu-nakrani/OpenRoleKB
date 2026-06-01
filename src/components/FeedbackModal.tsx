"use client";

import { useState, useEffect, useRef } from "react";

const KINDS = [
  { value: "wrong_role", label: "Wrong role" },
  { value: "wrong_seniority", label: "Wrong seniority" },
  { value: "wrong_location", label: "Wrong location" },
  { value: "stale", label: "Already filled / stale" },
  { value: "other", label: "Something else" },
];

interface FeedbackModalProps {
  open: boolean;
  onClose: () => void;
  jobId: string;
  rawQuery: string;
  filters: Record<string, unknown> | null;
  rerankScore: number | null;
  fit: string | null;
}

export function FeedbackModal({
  open,
  onClose,
  jobId,
  rawQuery,
  filters,
  rerankScore,
  fit,
}: FeedbackModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [kind, setKind] = useState<string>("");
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (open) {
      dialogRef.current?.showModal();
    } else {
      dialogRef.current?.close();
      setKind("");
      setComment("");
      setSubmitted(false);
    }
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!kind) return;
    setSubmitting(true);
    try {
      const anonId = localStorage.getItem("openrolekb_anon_id");
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-anon-id": anonId || "" },
        body: JSON.stringify({
          jobId,
          rawQuery,
          filters: filters || {},
          rerankScore,
          fit,
          kind,
          comment: comment.slice(0, 500),
        }),
      });
      setSubmitted(true);
    } catch {
      // silently fail
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="backdrop:bg-black/50 rounded-2xl border border-border-strong bg-surface p-0 max-w-md w-[90vw] shadow-card open:animate-fade-in"
      style={{ animation: submitted ? "none" : undefined }}
    >
      <div className="p-6">
        {submitted ? (
          <div className="text-center py-4">
            <p className="text-body">Thanks, that helps.</p>
            <button onClick={onClose} className="mt-4 text-accent text-small hover:underline">
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <h3 className="text-h2 font-medium mb-4">What was off?</h3>
            <div className="space-y-2 mb-4">
              {KINDS.map((k) => (
                <label key={k.value} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="kind"
                    value={k.value}
                    checked={kind === k.value}
                    onChange={(e) => setKind(e.target.value)}
                    className="accent-accent"
                  />
                  <span className="text-small">{k.label}</span>
                </label>
              ))}
            </div>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={500}
              placeholder="Any other details? (optional)"
              rows={3}
              className="w-full rounded-lg border border-border bg-surface text-small text-ink p-3 resize-none placeholder:text-muted focus-visible:outline-none focus-visible:border-border-strong focus-visible:ring-1 focus-visible:ring-accent/40 transition-all duration-120"
            />
            <p className="text-micro text-ink-soft text-right mt-1">{comment.length}/500</p>
            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 rounded-full border border-border text-small text-ink-soft hover:bg-surface-2 active:bg-surface-3 active:scale-[0.98] transition-all duration-120"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!kind || submitting}
                className="flex-1 px-4 py-2 rounded-full bg-accent-dark text-accent-text text-small font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 active:brightness-90 active:scale-[0.98] transition-all duration-120"
              >
                {submitting ? "Sending…" : "Submit"}
              </button>
            </div>
          </form>
        )}
      </div>
    </dialog>
  );
}

