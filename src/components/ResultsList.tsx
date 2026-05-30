"use client";

import { useEffect, useMemo } from "react";
import { ResultRow } from "@/components/ResultRow";
import { Skeleton } from "@/components/Skeleton";
import { extractCompany } from "@/lib/company";
import type { ExaResult, RerankItem } from "@/types/job";

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
  const results = useMemo(() => {
    if (reranked.length > 0) {
      return reranked.map((r) => ({ ...exaResults[r.idx], score: r.score, fit: r.fit, originalIdx: r.idx }));
    }
    return exaResults.map((r, i) => ({ ...r, score: undefined, fit: undefined, originalIdx: i }));
  }, [exaResults, reranked]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (results.length === 0) return;
      const active = document.activeElement;
      if (active instanceof HTMLElement &&
        (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = selectedIdx === null ? 0 : Math.min(selectedIdx + 1, results.length - 1);
        onSelect(next);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prev = selectedIdx === null ? results.length - 1 : Math.max(selectedIdx - 1, 0);
        onSelect(prev);
      } else if (e.key === "Enter" && selectedIdx !== null) {
        e.preventDefault();
        const url = results[selectedIdx]?.url;
        if (url) window.open(url, "_blank", "noopener,noreferrer");
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [results, selectedIdx, onSelect]);

  if (loading && exaResults.length === 0) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-[76px] w-full" />
        ))}
      </div>
    );
  }

  if (!loading && results.length === 0) return null;

  return (
    <div role="listbox" aria-label="Search results" className="space-y-2">
      {results.map((r, i) => (
        <ResultRow
          key={r.url || i}
          title={r.title}
          url={r.url}
          company={extractCompany(r.url) || (r as { author?: string }).author}
          fit={(r as { fit?: string }).fit}
          score={r.score}
          pulse={showPulse && r.score === undefined}
          isSelected={selectedIdx === i}
          onClick={() => onSelect(i)}
        />
      ))}
    </div>
  );
}
