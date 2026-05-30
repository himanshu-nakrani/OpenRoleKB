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
    try {
      const anonId = getAnonId();
      await fetch(`/api/saved?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { "x-anon-id": anonId },
      });
      setSearches((s) => s.filter((r) => r.id !== id));
    } catch {}
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
    <div className="mt-4 max-w-3xl mx-auto">
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
        <span className="text-micro text-ink-soft shrink-0">Recent:</span>
        {searches.map((s) => (
          <div
            key={s.id}
            className="group flex items-center gap-1 shrink-0"
          >
            <button
              onClick={() => handleRerun(s.rawQuery)}
              className="px-3 py-1 text-micro rounded-full bg-surface-2 text-ink-soft hover:bg-surface-2/80 transition-colors truncate max-w-[200px]"
            >
              {s.rawQuery.length > 28 ? s.rawQuery.substring(0, 26) + "…" : s.rawQuery}
            </button>
            <button
              onClick={() => handleDelete(s.id)}
              className="shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-ink-soft/40 hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity"
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
            className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center bg-surface-2 text-ink-soft hover:text-accent transition-colors"
            title="Save this search"
            aria-label="Save this search"
          >
            <Plus size={14} strokeWidth={2} aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}
