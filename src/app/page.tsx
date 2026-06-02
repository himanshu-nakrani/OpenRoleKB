"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { SearchBox } from "@/components/SearchBox";
import { ResultsList } from "@/components/ResultsList";
import { DetailPane } from "@/components/DetailPane";
import { SavedSearches } from "@/components/SavedSearches";
import { DetailSheet } from "@/components/DetailSheet";
import { DemoLoop } from "@/components/DemoLoop";
import { AtsStrip } from "@/components/AtsStrip";
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

  const showLanding = searchState.exaResults.length === 0 && searchState.phase !== "loading";

  return (
    <div ref={containerRef}>
      {/* Editorial copy + demo — only on the empty landing state.
        SearchBox stays below it in a stable DOM position so the
        React instance isn't destroyed when phase flips to loading. */}
      {showLanding && <EditorialLanding />}

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
        <div className="mt-6 flex gap-6 max-w-6xl mx-auto flex-col md:flex-row md:h-[calc(100vh-10rem)]">
          <div className="w-full md:w-[380px] shrink-0 overflow-y-auto">
            <ResultsList
              exaResults={searchState.exaResults}
              reranked={searchState.reranked}
              loading={searchState.phase === "loading"}
              selectedIdx={selectedIdx}
              onSelect={setSelectedIdx}
              showPulse={searchState.phase === "loading" || searchState.reranked.length === 0}
            />
          </div>
          <div className="hidden md:block flex-1 overflow-y-auto">
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

function EditorialLanding() {
  return (
    <section className="max-w-6xl mx-auto px-4 pt-8 md:pt-14 pb-12 grid gap-8 lg:gap-14 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] items-center animate-fade-in">
      {/* Left: editorial copy */}
      <div className="flex flex-col gap-7 max-w-xl">
        <div>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent-soft/60 border border-accent/15 text-micro text-accent-dark font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-breathe" aria-hidden />
            Open beta · No signup
          </span>
        </div>

        <h1 className="text-display font-display-opsz-display text-ink leading-[1.05] tracking-tight">
          Hiring for the role you{" "}
          <span className="text-accent-dark">actually want.</span>
        </h1>

        <p className="text-body text-ink-soft max-w-md leading-relaxed">
          Describe the role like you would to a friend. We search live across real ATS pages, then an AI ranks every match against your full ask.
        </p>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-micro text-muted">
          <span className="inline-flex items-center gap-1.5">
            <CheckIcon /> No login required
          </span>
          <span className="inline-flex items-center gap-1.5">
            <CheckIcon /> Live ATS results
          </span>
          <span className="inline-flex items-center gap-1.5">
            <CheckIcon /> Open source
          </span>
        </div>
      </div>

      {/* Right: demo loop + ATS strip */}
      <div className="flex flex-col gap-6 lg:gap-8 w-full">
        <DemoLoop />
        <AtsStrip />
      </div>
    </section>
  );
}

function CheckIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="text-accent"
      aria-hidden
    >
      <path d="M2 6.5L4.5 9L10 3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
