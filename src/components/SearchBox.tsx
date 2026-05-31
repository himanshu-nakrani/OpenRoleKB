"use client";

import { useState, useEffect, useRef } from "react";
import { Search, CornerDownLeft, X } from "lucide-react";
import type { Filters, ExaResult, RerankItem } from "@/types/job";

interface SearchState {
  phase: "idle" | "loading" | "error";
  filters: Filters | null;
  exaResults: ExaResult[];
  reranked: RerankItem[];
  error: string | null;
}

const PLACEHOLDERS = [
  "senior react role, remote-friendly, EU timezone, no crypto",
  "junior frontend in berlin, posted this month",
  "staff python engineer with ML experience, sf",
  "first product manager, fintech, remote US",
];

interface SearchBoxProps {
  onStateChange: (state: SearchState) => void;
}

export function SearchBox({ onStateChange }: SearchBoxProps) {
  const [query, setQuery] = useState("");
  const [saved, setSaved] = useState(false);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const [focused, setFocused] = useState(false);
  const [state, setState] = useState<SearchState>({
    phase: "idle",
    filters: null,
    exaResults: [],
    reranked: [],
    error: null,
  });
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (focused) return;
    const timer = setInterval(() => {
      setPlaceholderIdx((i) => (i + 1) % PLACEHOLDERS.length);
    }, 5000);
    return () => clearInterval(timer);
  }, [focused]);

  useEffect(() => {
    function handleGlobalKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        const el = document.querySelector<HTMLInputElement>('[data-ask-bar]');
        el?.focus();
      }
    }
    function handleSaveCurrent() {
      const s = stateRef.current;
      if (s.phase === "idle" && s.exaResults.length > 0) handleSave();
    }
    window.addEventListener("keydown", handleGlobalKey);
    window.addEventListener("openrolekb:save-current", handleSaveCurrent);
    return () => {
      window.removeEventListener("keydown", handleGlobalKey);
      window.removeEventListener("openrolekb:save-current", handleSaveCurrent);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    onStateChange(state);
  }, [state, onStateChange]);

  async function runSearch(filters?: Filters) {
    const q = query.trim();
    if (!q) return;

    setSaved(false);
    const newState: SearchState = {
      phase: "loading",
      filters: filters || null,
      exaResults: [],
      reranked: [],
      error: null,
    };
    setState(newState);

    try {
      const anonId = getAnonId();
      const res = await fetch("/api/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-anon-id": anonId,
        },
        body: JSON.stringify({ query: q }),
      });

      if (!res.ok) {
        const err = await res.json();
        setState((s) => ({ ...s, phase: "error", error: err.error || "Search failed" }));
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let eventType = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7);
          } else if (line.startsWith("data: ") && eventType) {
            try {
              const data: Record<string, unknown> = JSON.parse(line.slice(6));
              setState((s) => {
                const next = { ...s };
                switch (eventType) {
                  case "parsed":
                    next.filters = data as unknown as Filters;
                    break;
                  case "results":
                    next.exaResults = data as unknown as ExaResult[];
                    break;
                  case "rerank":
                    next.reranked = data as unknown as RerankItem[];
                    break;
                  case "done":
                    next.phase = "idle";
                    break;
                  case "error":
                    next.phase = "error";
                    next.error = (data as unknown as { message: string }).message;
                    break;
                }
                return next;
              });
            } catch {}
            eventType = "";
          }
        }
      }
    } catch (err) {
      setState((s) => ({
        ...s,
        phase: "error",
        error: err instanceof Error ? err.message : "Network error",
      }));
    }
  }

  async function handleSave() {
    try {
      const anonId = getAnonId();
      await fetch("/api/saved", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-anon-id": anonId,
        },
        body: JSON.stringify({ rawQuery: query.trim(), filters: state.filters }),
      });
      setSaved(true);
      window.dispatchEvent(new CustomEvent("openrolekb:saved-changed"));
    } catch {}
  }

  function handleDropFilter(key: keyof Filters, value?: string) {
    if (!state.filters) return;
    const updated = { ...state.filters };
    if (key === "skills" && value) {
      updated.skills = state.filters.skills?.filter((s) => s !== value);
      if (!updated.skills?.length) updated.skills = undefined;
    } else if (key === "exclude" && value) {
      updated.exclude = state.filters.exclude?.filter((s) => s !== value);
      if (!updated.exclude?.length) updated.exclude = undefined;
    } else if (key === "remote") {
      updated.remote = undefined;
    } else if (key === "freshnessDays") {
      updated.freshnessDays = undefined;
    } else if (key === "salaryMin") {
      updated.salaryMin = undefined;
    } else {
      (updated as Record<string, undefined>)[key] = undefined;
    }
    setSaved(false);
    runSearch(updated);
  }

  return (
    <div className="w-full max-w-3xl mx-auto">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          runSearch();
        }}
        className="relative mb-4"
      >
        <div className="relative">
          <span className="absolute left-5 top-1/2 -translate-y-1/2 text-ink-soft pointer-events-none">
            <Search size={18} strokeWidth={1.5} aria-hidden />
          </span>
          <input
            data-ask-bar
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={PLACEHOLDERS[placeholderIdx]}
            className="w-full h-14 pl-12 pr-14 rounded-full border-[1.5px] border-border bg-surface text-ink placeholder:text-muted focus-visible:outline-none focus-visible:border-border-strong focus-visible:ring-1 focus-visible:ring-accent/30 focus-visible:shadow-card-hover text-body transition-all duration-120"
            disabled={state.phase === "loading"}
          />
          <button
            type="submit"
            disabled={state.phase === "loading" || !query.trim()}
            aria-label="Search"
            className="absolute right-2 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-accent-dark text-accent-text flex items-center justify-center shadow-sm hover:brightness-115 active:brightness-90 disabled:opacity-30 disabled:bg-surface-3 disabled:hover:brightness-100 disabled:active:brightness-100 disabled:cursor-not-allowed transition-all duration-120"
          >
            <CornerDownLeft size={18} strokeWidth={2} aria-hidden />
          </button>
        </div>
        {state.phase === "loading" && (
          <div className="absolute inset-0 rounded-full overflow-hidden pointer-events-none">
            <div className="h-full w-1/3 bg-gradient-to-r from-transparent via-accent-soft/50 to-transparent animate-shimmer" />
          </div>
        )}
      </form>

      {state.filters && <WeHeard filters={state.filters} onDrop={handleDropFilter} />}

      {state.phase === "idle" && state.filters && state.exaResults.length > 0 && (
        <div className="mb-2">
          <button
            onClick={handleSave}
            disabled={saved}
            className={saved
              ? "px-4 py-2 text-micro rounded-full border border-success/40 bg-success/10 text-success animate-pulse-success disabled:opacity-70 disabled:cursor-default transition-all duration-120"
              : "px-4 py-2 text-micro rounded-full border border-border text-muted hover:text-ink-soft hover:border-border-strong hover:bg-surface-2 active:bg-surface-3 active:scale-[0.98] transition-all duration-120"
            }
          >
            {saved ? "Saved ✓" : "Save this search"}
          </button>
        </div>
      )}

      {state.error && (
        <div className="mt-4 p-4 border-l-[3px] border-l-danger bg-surface rounded-r-lg text-small text-ink-soft animate-fade-in">
          <p className="font-medium text-ink">Couldn&apos;t reach the search service.</p>
          <p className="mt-1">{state.error}</p>
          <button
            onClick={() => runSearch()}
            className="mt-2 text-accent hover:underline text-small transition-colors duration-120"
          >
            Try again
          </button>
        </div>
      )}

      <ExampleQueries />
    </div>
  );
}

function WeHeard({
  filters,
  onDrop,
}: {
  filters: Filters;
  onDrop: (key: keyof Filters, value?: string) => void;
}) {
  const entries: { key: string; label: string }[] = [];
  if (filters.role) entries.push({ key: "role", label: filters.role });
  if (filters.seniority) entries.push({ key: "seniority", label: filters.seniority });
  if (filters.location) entries.push({ key: "location", label: filters.location });
  if (filters.remote) entries.push({ key: "remote", label: "remote" });
  if (filters.salaryMin) entries.push({ key: "salaryMin", label: `≥$${filters.salaryMin.toLocaleString()}` });
  if (filters.skills) filters.skills.forEach((s) => entries.push({ key: "skills", label: s }));
  if (filters.freshnessDays) entries.push({ key: "freshnessDays", label: `last ${filters.freshnessDays}d` });

  if (entries.length === 0) return null;

  return (
    <div className="flex items-center gap-2 mb-4 flex-wrap">
      <span className="text-micro text-ink-soft mr-1">We heard:</span>
      {entries.map((e, i) => (
        <button
          key={i}
          onClick={() => onDrop(e.key as keyof Filters, e.label)}
          className="group inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-2 text-micro text-muted hover:text-ink-soft hover:bg-surface-3 transition-all duration-120"
        >
          {e.label}
          <X
            size={12}
            strokeWidth={2}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-ink-soft/60"
            aria-hidden
          />
        </button>
      ))}
    </div>
  );
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

const EXAMPLES = [
  { label: "senior react, remote EU", query: "senior react role, remote-friendly, EU timezone, no crypto" },
  { label: "junior PM, fintech NYC", query: "junior product manager, fintech, New York" },
  { label: "data eng with dbt", query: "data engineer with dbt and snowflake experience" },
  { label: "Rust backend, anywhere", query: "senior software engineer, Rust, remote" },
];

function ExampleQueries() {
  const key = "openrolekb_examples_seen";
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem(key) === null) {
      setVisible(true);
    }
  }, []);

  function handleClick(query: string) {
    sessionStorage.setItem(key, "1");
    setVisible(false);
    const input = document.querySelector<HTMLInputElement>('[data-ask-bar]');
    if (input) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, query);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.closest("form")?.requestSubmit();
    }
  }

  if (!visible) return null;

  return (
    <div className="mt-6 text-center">
      <p className="text-micro text-ink-soft mb-4">Try:</p>
      <div className="flex flex-wrap justify-center gap-2">
        {EXAMPLES.map((e) => (
          <button
            key={e.label}
            onClick={() => handleClick(e.query)}
                      className="px-4 py-2 text-small rounded-full border border-border text-muted hover:text-ink-soft hover:border-border-strong hover:bg-surface-2 active:bg-surface-3 active:scale-[0.98] transition-all duration-120"
          >
            &ldquo;{e.label}&rdquo;
          </button>
        ))}
      </div>
    </div>
  );
}
