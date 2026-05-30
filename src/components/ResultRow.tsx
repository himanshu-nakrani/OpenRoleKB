"use client";

import { useEffect, useRef } from "react";
import { ScoreChip } from "@/components/ScoreChip";

interface ResultRowProps {
  title: string;
  url: string;
  company?: string;
  fit?: string;
  score?: number;
  pulse?: boolean;
  isSelected?: boolean;
  onClick: () => void;
}

export function ResultRow({
  title,
  url,
  company,
  fit,
  score,
  isSelected,
  onClick,
}: ResultRowProps) {
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isSelected && ref.current) {
      ref.current.scrollIntoView({ block: "nearest" });
    }
  }, [isSelected]);

  return (
    <button
      ref={ref}
      onClick={onClick}
      className={`w-full text-left px-5 py-4 rounded-lg border transition-all duration-180 ${
        isSelected
          ? "bg-surface-2 border-l-[3px] border-l-accent border-border"
          : "bg-surface border-border hover:bg-surface-2/60"
      } focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent`}
      role="option"
      aria-selected={isSelected}
    >
      <div className="flex items-start justify-between gap-2 min-w-0">
        <div className="flex-1 min-w-0">
          <p className="text-body font-medium text-ink truncate">{title}</p>
          <p className="text-small text-ink-soft truncate mt-0.5">
            {[company, url ? new URL(url).hostname.replace("www.", "") : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <ScoreChip score={score} className="shrink-0 mt-0.5" />
      </div>
      {fit && (
        <p className="text-small italic text-success mt-1.5 leading-snug line-clamp-1" title={fit}>
          {fit}
        </p>
      )}
    </button>
  );
}
