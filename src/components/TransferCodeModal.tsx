"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { X } from "lucide-react";

type Mode = "generate" | "redeem" | null;

interface Props {
  mode: Mode;
  onClose: () => void;
}

export function TransferCodeModal({ mode, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [code, setCode] = useState("");
  const [input, setInput] = useState("");
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // External-system sync: keep the DOM <dialog> aligned with the mode prop.
  // No React state changes here, so the purity rule is satisfied.
  useEffect(() => {
    if (mode) {
      dialogRef.current?.showModal();
    } else {
      dialogRef.current?.close();
    }
  }, [mode]);

  function handleClose() {
    setCode("");
    setInput("");
    setExpiresAt(null);
    setError("");
    onClose();
  }

  const handleGenerate = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const anonId = localStorage.getItem("openrolekb_anon_id");
      const res = await fetch("/api/transfer-code", {
        method: "POST",
        headers: { "x-anon-id": anonId || "" },
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setCode(data.code);
      setExpiresAt(new Date(data.expiresAt));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate code");
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-trigger generation on first open in "generate" mode. Guarded by a ref
  // so we don't refetch when other state changes cause a re-render.
  const generateTriggeredRef = useRef(false);
  useEffect(() => {
    if (mode === "generate" && !generateTriggeredRef.current) {
      generateTriggeredRef.current = true;
      void handleGenerate();
    }
    if (mode === null) {
      generateTriggeredRef.current = false;
    }
  }, [mode, handleGenerate]);

  // Tick once a minute while a code is live so "expires in N minutes" stays
  // fresh without reading Date.now() during render (purity rule).
  const [nowTick, setNowTick] = useState(0);
  useEffect(() => {
    if (!expiresAt) return;
    const id = window.setInterval(() => setNowTick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, [expiresAt]);

  async function handleRedeem() {
    if (input.length !== 6) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/transfer-code/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: input.toUpperCase() }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      localStorage.setItem("openrolekb_anon_id", data.anonId);
      window.dispatchEvent(new CustomEvent("openrolekb:saved-changed"));
      window.dispatchEvent(new CustomEvent("openrolekb:transfer-complete"));
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid or expired code");
    } finally {
      setLoading(false);
    }
  }

  if (!mode) return null;

  // Read Date.now() outside render via the nowTick dependency.
  // nowTick changes every 30s when a code is live; otherwise it's static.
  // eslint-disable-next-line react-hooks/purity
  const nowMs = (() => { void nowTick; return Date.now(); })();
  const expiresInMinutes = expiresAt
    ? Math.max(0, Math.floor((expiresAt.getTime() - nowMs) / 60000))
    : 0;

  return (
    <dialog
      ref={dialogRef}
      onClose={handleClose}
      aria-label={mode === "generate" ? "Transfer to another device" : "Enter transfer code"}
      className="backdrop:bg-black/60 rounded-2xl border border-border-strong bg-surface p-0 max-w-md w-[90vw] shadow-card open:animate-fade-in"
    >
      <div className="p-6 relative">
        <button
          onClick={handleClose}
                  className="absolute top-4 right-4 text-ink-soft hover:text-ink transition-colors duration-120"
          aria-label="Close"
        >
          <X size={20} strokeWidth={1.5} />
        </button>

        {mode === "generate" && (
          <>
            <h2 className="text-h2 font-medium mb-4">Transfer to another device</h2>
            {loading && <p className="text-small text-ink-soft">Generating code…</p>}
            {error && <p className="text-small text-danger mb-4">{error}</p>}
            {code && (
              <>
                <p className="text-small text-ink-soft mb-4">
                  Enter this code on your other device within 10 minutes:
                </p>
                <div
                  className="bg-surface-2 rounded-lg p-4 text-center mb-4"
                  aria-describedby="code-expiry"
                >
                  <p className="text-[2rem] font-mono font-bold tracking-widest text-ink">
                    {code}
                  </p>
                </div>
                <button
                  onClick={() => navigator.clipboard.writeText(code)}
                  className="w-full px-4 py-2 rounded-full bg-accent-dark text-accent-text hover:brightness-110 active:brightness-90 active:scale-[0.98] transition-all duration-120"
                >
                  Copy code
                </button>
                <p id="code-expiry" className="text-micro text-muted mt-2 text-center">
                  Expires in {expiresInMinutes} minutes
                </p>
              </>
            )}
          </>
        )}

        {mode === "redeem" && (
          <>
            <h2 className="text-h2 font-medium mb-4">Enter transfer code</h2>
            <p className="text-small text-ink-soft mb-4">
              Enter the 6-character code from your other device:
            </p>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value.toUpperCase().slice(0, 6))}
              placeholder="ABC123"
              className="w-full px-4 py-3 rounded-lg border border-border bg-surface text-center text-[1.5rem] font-mono tracking-widest uppercase mb-4 placeholder:text-muted focus-visible:outline-none focus-visible:border-border-strong focus-visible:ring-1 focus-visible:ring-accent/40 transition-all duration-120"
              maxLength={6}
              autoFocus
            />
            {error && <p className="text-small text-danger mb-4">{error}</p>}
            <button
              onClick={handleRedeem}
              disabled={input.length !== 6 || loading}
              className="w-full px-4 py-2 rounded-full bg-accent-dark text-accent-text hover:brightness-110 active:brightness-90 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-120"
            >
              {loading ? "Redeeming…" : "Transfer"}
            </button>
          </>
        )}
      </div>
    </dialog>
  );
}
