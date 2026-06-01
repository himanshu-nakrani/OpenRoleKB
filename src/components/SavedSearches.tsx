"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { X, Plus } from "lucide-react";

interface SavedSearch {
  id: string;
  rawQuery: string;
  filters: Record<string, unknown>;
  createdAt: string;
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

  if (searches.length === 0 && !hasUnsavedSearch) return null;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mt-6 rounded-xl bg-surface-2 border border-border/60 px-4 py-3">
        <p className="text-micro text-muted mb-2">Your saved searches</p>
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-none">
          {searches.map((s) => (
            <div
              key={s.id}
              className="group flex items-center gap-1 shrink-0"
            >
              <button
                onClick={() => handleRerun(s.rawQuery)}
                className="px-4 py-1 text-micro rounded-full bg-surface text-ink-soft hover:bg-surface-3 transition-colors duration-120 truncate max-w-[220px]"
              >
                {s.rawQuery.length > 30 ? s.rawQuery.substring(0, 28) + "…" : s.rawQuery}
              </button>
              <button
                onClick={() => handleDelete(s.id)}
                className="shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-ink-soft/40 hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity duration-120"
                title="Remove saved search"
                aria-label="Remove saved search"
              >
                <X size={12} strokeWidth={2} aria-hidden />
              </button>
            </div>
          ))}
          {hasUnsavedSearch && onSaveCurrent && (
            <button
              onClick={onSaveCurrent}
              className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center bg-surface text-ink-soft hover:text-accent transition-colors duration-120"
              title="Save current search"
              aria-label="Save current search"
            >
              <Plus size={14} strokeWidth={2} aria-hidden />
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
    </div>
  );
}
