"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { X, Plus, Bell } from "lucide-react";

interface SavedSearch {
  id: string;
  rawQuery: string;
  filters: Record<string, unknown>;
  createdAt: string;
  cadence?: string;
  notifyEmail?: string;
}

function getAnonId(): string {
  const key = "openrolekb_anon_id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

interface SavedSearchesProps {
  hasUnsavedSearch?: boolean;
  onSaveCurrent?: () => void;
}

export function SavedSearches({ hasUnsavedSearch, onSaveCurrent }: SavedSearchesProps) {
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [undo, setUndo] = useState<SavedSearch | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [emailInput, setEmailInput] = useState<Record<string, string>>({});
  const fetchedRef = useRef(false);

  const loadSearches = useCallback(async () => {
    try {
      const anonId = getAnonId();
      const res = await fetch("/api/saved", {
        headers: { "x-anon-id": anonId },
      });
      if (res.ok) {
        setSearches(await res.json());
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    loadSearches();
    const handler = () => loadSearches();
    window.addEventListener("openrolekb:saved-changed", handler);
    return () => window.removeEventListener("openrolekb:saved-changed", handler);
  }, [loadSearches]);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  async function handleDelete(id: string) {
    const item = searches.find((s) => s.id === id);
    if (!item) return;
    setSearches((s) => s.filter((r) => r.id !== id));
    setUndo(item);
    setTimeout(() => {
      setUndo(null);
    }, 4000);
    try {
      const anonId = getAnonId();
      await fetch(`/api/saved?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { "x-anon-id": anonId },
      });
      setUndo(null);
    } catch {
      setSearches((s) => [...s, item].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      setUndo(null);
    }
  }

  function handleUndo() {
    if (!undo) return;
    const toRestore = undo;
    setSearches((s) => [...s, toRestore].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
    setUndo(null);
    fetch("/api/saved", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-anon-id": getAnonId() },
      body: JSON.stringify({ rawQuery: toRestore.rawQuery, filters: toRestore.filters }),
    }).catch(() => {});
  }

  function handleRerun(rawQuery: string) {
    const input = document.querySelector<HTMLInputElement>('[data-ask-bar]');
    if (input) {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      nativeInputValueSetter?.call(input, rawQuery);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.form?.requestSubmit();
    }
  }

  async function handleCadenceChange(id: string, cadence: string) {
    const search = searches.find((s) => s.id === id);
    if (!search) return;

    if (cadence !== "off" && !search.notifyEmail) {
      setEmailInput((prev) => ({ ...prev, [id]: "" }));
      return;
    }

    try {
      const anonId = getAnonId();
      const res = await fetch("/api/saved", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-anon-id": anonId },
        body: JSON.stringify({ id, cadence, notifyEmail: emailInput[id] }),
      });

      if (res.ok) {
        setSearches((s) => s.map((item) => (item.id === id ? { ...item, cadence, notifyEmail: emailInput[id] } : item)));
        setToast(`Digest set to ${cadence}`);
        setEmailInput((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      } else {
        const err = await res.json();
        setToast(err.error || "Failed to update cadence");
      }
    } catch {
      setToast("Network error while updating cadence");
    }
  }

  if (searches.length === 0 && !hasUnsavedSearch) return null;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mt-6 rounded-xl bg-surface-2 border border-border/60 px-4 py-3">
        <p className="text-micro text-muted mb-2">Your saved searches</p>
        <div className="flex flex-col gap-3">
          {searches.map((s) => (
            <div key={s.id} className="group relative flex items-center gap-2">
              <button
                onClick={() => handleRerun(s.rawQuery)}
                className="flex-1 px-4 py-1.5 text-micro rounded-full bg-surface text-ink-soft hover:bg-surface-3 transition-colors duration-120 truncate text-left"
              >
                {s.rawQuery.length > 40 ? s.rawQuery.substring(0, 38) + "…" : s.rawQuery}
              </button>
              
              <select
                value={s.cadence || "off"}
                onChange={(e) => handleCadenceChange(s.id, e.target.value)}
                className="text-micro rounded-md border border-border bg-surface text-ink-soft px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="off">Off</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>

              <button
                onClick={() => handleDelete(s.id)}
                className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-ink-soft/40 hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity duration-120"
                title="Remove saved search"
                aria-label="Remove saved search"
              >
                <X size={14} strokeWidth={2} aria-hidden />
              </button>

              {emailInput[s.id] !== undefined && (
                <div className="absolute right-0 top-full mt-2 p-3 bg-surface border border-border rounded-lg shadow-lg z-10 w-64">
                  <p className="text-micro text-muted mb-2">Enter email for digest:</p>
                  <input
                    type="email"
                    value={emailInput[s.id]}
                    onChange={(e) => setEmailInput((prev) => ({ ...prev, [s.id]: e.target.value }))}
                    placeholder="you@example.com"
                    className="w-full text-small px-2 py-1 rounded border border-border bg-bg text-ink mb-2 focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setEmailInput((prev) => { const next = { ...prev }; delete next[s.id]; return next; })}
                      className="text-micro text-muted hover:text-ink"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleCadenceChange(s.id, s.cadence || "daily")}
                      className="text-micro text-accent hover:underline"
                    >
                      Save
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {hasUnsavedSearch && onSaveCurrent && (
            <button
              onClick={onSaveCurrent}
              className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-surface text-ink-soft hover:text-accent transition-colors duration-120"
              title="Save current search"
              aria-label="Save current search"
            >
              <Plus size={16} strokeWidth={2} aria-hidden />
            </button>
          )}
        </div>
      </div>
      {undo && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-ink text-bg text-small shadow-lg animate-slide-up">
          Removed.{" "}
          <button onClick={handleUndo} className="text-accent hover:underline">
            Undo
          </button>
        </div>
      )}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-accent-dark text-accent-text text-small shadow-lg animate-slide-up flex items-center gap-2">
          <Bell size={14} />
          {toast}
        </div>
      )}
    </div>
  );
}
