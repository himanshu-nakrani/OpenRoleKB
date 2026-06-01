"use client";

import { useState, useEffect, useMemo } from "react";
import { ResultRow } from "@/components/ResultRow";
import { LoadingNarrative } from "@/components/LoadingNarrative";
import { extractCompany } from "@/lib/company";
import type { ExaResult, RerankItem } from "@/types/job";

interface MergedResult extends ExaResult {
  score?: number;
  fit?: string;
  originalIdx: number;
}

interface ResultsListProps {
  exaResults: ExaResult[];
  reranked: RerankItem[];
  loading: boolean;
  selectedIdx: number | null;
  onSelect: (idx: number) => void;
  showPulse?: boolean;
}

export function ResultsList({
  exaResults,
  reranked,
  loading,
  selectedIdx,
  onSelect,
  showPulse = false,
}: ResultsListProps) {
  const [visibleCount, setVisibleCount] = useState(25);
  const [sortMode, setSortMode] = useState<"match" | "newest">("match");

  // Reset visibleCount when the results identity changes. React's official
  // pattern for "derive state from a prop change" — set during render rather
  // than in an effect, which avoids a wasted re-render and satisfies
  // react-hooks/set-state-in-effect.
  // https://react.dev/reference/react/useState#storing-information-from-previous-renders
  const [prevResultsKey, setPrevResultsKey] = useState<string>("");
  const resultsKey = `${exaResults.length}:${reranked.length}`;
  if (resultsKey !== prevResultsKey) {
    setPrevResultsKey(resultsKey);
    setVisibleCount(25);
  }

  const results = useMemo<MergedResult[]>(() => {
    let merged: MergedResult[];
    if (reranked.length > 0) {
      merged = reranked.map((r) => ({ ...exaResults[r.idx], score: r.score, fit: r.fit, originalIdx: r.idx }));
    } else {
      merged = exaResults.map((r, i) => ({ ...r, score: undefined, fit: undefined, originalIdx: i }));
    }

    if (sortMode === "newest") {
      merged = [...merged].sort((a, b) => {
        if (!a.publishedDate && !b.publishedDate) return 0;
        if (!a.publishedDate) return 1;
        if (!b.publishedDate) return -1;
        return new Date(b.publishedDate).getTime() - new Date(a.publishedDate).getTime();
      });
    }

    return merged;
  }, [exaResults, reranked, sortMode]);

  const visible = useMemo(() => results.slice(0, visibleCount), [results, visibleCount]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (visible.length === 0) return;
      const active = document.activeElement;
      if (active instanceof HTMLElement &&
        (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = selectedIdx === null ? 0 : Math.min(selectedIdx + 1, visible.length - 1);
        onSelect(next);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prev = selectedIdx === null ? visible.length - 1 : Math.max(selectedIdx - 1, 0);
        onSelect(prev);
      } else if (e.key === "Enter" && selectedIdx !== null) {
        e.preventDefault();
        const url = visible[selectedIdx]?.url;
        if (url) window.open(url, "_blank", "noopener,noreferrer");
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [visible, selectedIdx, onSelect]);

  if (loading && exaResults.length === 0) {
    return <LoadingNarrative hasPartialResults={false} />;
  }

  if (!loading && results.length === 0) {
    const examples = [
      "senior react, remote EU, no crypto",
      "junior product manager, fintech, New York",
      "staff data engineer with dbt, Snowflake",
    ];
    function rerun(q: string) {
      const input = document.querySelector<HTMLInputElement>('[data-ask-bar]');
      if (!input) return;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, q);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.closest("form")?.requestSubmit();
    }
    return (
      <div className="text-center py-12 px-4 animate-fade-in">
        <p className="text-body text-ink">No matches for that exact ask.</p>
        <p className="text-small text-muted mt-2">
          Try broader terms, fewer filters, or one of these:
        </p>
        <div className="flex flex-wrap justify-center gap-2 mt-4">
          {examples.map((q) => (
            <button
              key={q}
              onClick={() => rerun(q)}
              className="px-3 py-1.5 text-micro rounded-full border border-border text-muted hover:text-ink-soft hover:border-border-strong hover:bg-surface-2 transition-all duration-120"
            >
              {q}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSortMode(sortMode === "match" ? "newest" : "match")}
            className="text-micro text-muted hover:text-ink transition-all duration-120 flex items-center gap-1.5"
          >
            {sortMode === "match" ? "Best match" : "Newest"}
            <svg width="10" height="6" viewBox="0 0 10 6" className="rotate-90 text-muted">
              <path d="M1 0.5l4 5 4-5" stroke="currentColor" fill="none" strokeWidth="1.5" />
            </svg>
          </button>
        </div>
        <span className="text-micro text-muted">{results.length} results</span>
      </div>

      <div role="listbox" aria-label="Search results" className="space-y-2">
        {visible.map((r, i) => (
          <span key={r.url || i}
            className="block animate-fade-in"
            style={{ animationDelay: `${Math.min(i, 7) * 30}ms` }}
          >
            {i === 0 && reranked.length > 0 && (
              <p className="text-micro text-muted pt-1 pb-0.5">Best matches</p>
            )}
            {i === Math.min(4, visible.length) && reranked.length > 0 && (
              <p className="text-micro text-muted pt-3 pb-0.5">More results</p>
            )}
            <ResultRow
              title={r.title}
              url={r.url}
              company={extractCompany(r.url) || (r as { author?: string }).author}
              fit={r.fit}
              score={r.score}
              publishedDate={r.publishedDate}
              pulse={showPulse && r.score === undefined}
              isSelected={selectedIdx === i}
              onClick={() => onSelect(i)}
            />
          </span>
        ))}
      </div>

      {visibleCount < results.length && (
        <button
          onClick={() => setVisibleCount((c) => Math.min(c + 25, results.length))}
          className="mt-3 w-full py-2 text-small text-muted hover:text-ink-soft border border-border rounded-lg hover:bg-surface-2 active:bg-surface-3 active:scale-[0.99] transition-all duration-120"
        >
          Show more ({results.length - visibleCount} remaining)
        </button>
      )}
    </div>
  );
}
