"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { SearchBox } from "@/components/SearchBox";
import { ResultsList } from "@/components/ResultsList";
import { DetailPane } from "@/components/DetailPane";
import { SavedSearches } from "@/components/SavedSearches";
import { DetailSheet } from "@/components/DetailSheet";
import type { ExaResult, Filters, RerankItem } from "@/types/job";

interface SearchState {
  phase: "idle" | "loading" | "error";
  filters: Filters | null;
  exaResults: ExaResult[];
  reranked: RerankItem[];
  error: string | null;
}

export default function Home() {
  const [searchState, setSearchState] = useState<SearchState>({
    phase: "idle",
    filters: null,
    exaResults: [],
    reranked: [],
    error: null,
  });
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    function handleChange(e: MediaQueryListEvent) { setIsMobile(e.matches); }
    handleChange({ matches: mq.matches } as MediaQueryListEvent);
    mq.addEventListener("change", handleChange);
    return () => mq.removeEventListener("change", handleChange);
  }, []);

  const handleStateChange = useCallback((state: SearchState) => {
    setSearchState(state);
    if (state.phase === "loading") setSelectedIdx(null);
  }, []);

  return (
    <div ref={containerRef}>
      {searchState.exaResults.length === 0 && searchState.phase !== "loading" && (
        <div className="max-w-3xl mx-auto pt-12 pb-8 text-center animate-fade-in">
          <h1 className="text-display font-display-opsz-display text-ink">
            Find a role you&apos;ll love.
          </h1>
          <p className="mt-4 text-body text-ink-soft max-w-xl mx-auto">
            Describe what you want in plain English. We&apos;ll do the searching.
          </p>
        </div>
      )}
      <SearchBox onStateChange={handleStateChange} />

      {searchState.exaResults.length === 0 && searchState.phase !== "loading" && (
        <SubHero />
      )}

      <SavedSearches
        hasUnsavedSearch={
          searchState.phase === "idle" &&
          searchState.exaResults.length > 0 &&
          searchState.filters !== null
        }
        onSaveCurrent={() => {
          window.dispatchEvent(new CustomEvent("openrolekb:save-current"));
        }}
      />

      {(searchState.exaResults.length > 0 || searchState.phase === "loading") && (
        <div className="mt-6 flex gap-6 max-w-6xl mx-auto flex-col md:flex-row">
          <div className="w-full md:w-[380px] shrink-0">
            <ResultsList
              exaResults={searchState.exaResults}
              reranked={searchState.reranked}
              loading={searchState.phase === "loading"}
              selectedIdx={selectedIdx}
              onSelect={setSelectedIdx}
              showPulse={searchState.phase === "loading" || searchState.reranked.length === 0}
            />
          </div>
          <div className="hidden md:block flex-1 min-h-[60vh]">
            <DetailPane
              exaResults={searchState.exaResults}
              reranked={searchState.reranked}
              selectedIdx={selectedIdx}
            />
          </div>
        </div>
      )}

      {isMobile ? (
        <DetailSheet
          exaResults={searchState.exaResults}
          reranked={searchState.reranked}
          selectedIdx={selectedIdx}
          onClose={() => setSelectedIdx(null)}
        />
      ) : null}
    </div>
  );
}

function SubHero() {
  const items = [
    {
      title: "Neural search",
      body: "Exa's neural index crawls career pages live — no stale boards, no indexing lag.",
    },
    {
      title: "AI-ranked",
      body: "Every result is scored against your full ask. Sub-40% matches are filtered out.",
    },
    {
      title: "Real ATS sources",
      body: "Direct from greenhouse.io, lever.co, ashbyhq, workable, workday and more.",
    },
  ];
  return (
    <section className="max-w-5xl mx-auto mt-16 mb-8 grid gap-6 sm:grid-cols-3 px-4 animate-fade-in">
      {items.map((it) => (
        <div
          key={it.title}
          className="rounded-2xl border border-border bg-surface/60 backdrop-blur-sm p-5 hover:border-border-strong transition-colors duration-120"
        >
          <h2 className="text-h2 font-medium text-ink font-display-opsz-h2">{it.title}</h2>
          <p className="mt-2 text-small text-ink-soft leading-relaxed">{it.body}</p>
        </div>
      ))}
    </section>
  );
}
