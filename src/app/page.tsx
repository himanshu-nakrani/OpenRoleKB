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
      <SearchBox onStateChange={handleStateChange} />

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
