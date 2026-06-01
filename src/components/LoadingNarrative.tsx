"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/Skeleton";

const STAGES = [
  { ms: 0, label: "Parsing your query…" },
  { ms: 700, label: "Searching ATS hosts across the web…" },
  { ms: 2500, label: "Ranking matches against your ask…" },
  { ms: 6000, label: "Polishing the top results…" },
];

interface LoadingNarrativeProps {
  hasPartialResults: boolean;
}

export function LoadingNarrative({ hasPartialResults }: LoadingNarrativeProps) {
  const [stageIdx, setStageIdx] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const id = window.setInterval(() => {
      const elapsed = Date.now() - start;
      let next = 0;
      for (let i = 0; i < STAGES.length; i++) {
        if (elapsed >= STAGES[i].ms) next = i;
      }
      setStageIdx(next);
    }, 200);
    return () => window.clearInterval(id);
  }, []);

  const label = hasPartialResults ? STAGES[2].label : STAGES[stageIdx].label;

  return (
    <div className="space-y-3" aria-busy="true" aria-live="polite">
      <div className="flex items-center gap-2 text-small text-ink-soft px-1 mb-2">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent animate-breathe" aria-hidden />
        <span>{label}</span>
      </div>
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-[76px] w-full" />
      ))}
    </div>
  );
}
