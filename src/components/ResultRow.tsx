"use client";

import { useEffect, useRef } from "react";
import { ScoreChip } from "@/components/ScoreChip";
import { FreshnessPill } from "@/components/FreshnessPill";
import { MIN_RERANK_SCORE } from "@/lib/config";

interface ResultRowProps {
  title: string;
  url: string;
  company?: string;
  fit?: string;
  score?: number;
  publishedDate?: string;
  pulse?: boolean;
  isSelected?: boolean;
  onClick: () => void;
  // P2 salary
  salaryMinUsd?: number;
  salaryMaxUsd?: number;
  salaryRaw?: string;
}

export function ResultRow({
  title,
  url,
  company,
  fit,
  score,
  publishedDate,
  isSelected,
  onClick,
  salaryMinUsd,
  salaryMaxUsd,
}: ResultRowProps) {
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isSelected && ref.current) {
      ref.current.scrollIntoView({ block: "nearest" });
    }
  }, [isSelected]);

  const domain = (() => {
    try { return new URL(url).hostname.replace("www.", ""); } catch { return null; }
  })();

  // Posting date is promoted out of the meta line into a colored pill below.
  // Meta line now carries only the always-truthy company + domain bits.
  const meta = [company, domain].filter(Boolean).join(" · ");

  const showScore = score !== undefined && score >= MIN_RERANK_SCORE;

  return (
    <button
      ref={ref}
      onClick={onClick}
      className={`w-full text-left px-5 py-4 rounded-xl border shadow-card transition-all duration-120 ${
        isSelected
          ? "bg-gradient-to-r from-accent-soft/60 via-surface-2 to-surface-2 border-l-2 border-l-accent border-border-strong"
          : "bg-surface border-border hover:bg-surface-2 hover:border-border-strong hover:-translate-y-px hover:shadow-card-hover"
      } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent`}
      role="option"
      aria-selected={isSelected}
    >
      <div className="flex items-start justify-between gap-2 min-w-0 min-h-[3.5rem]">
        <div className="flex-1 min-w-0">
          <p className="text-body font-medium text-ink truncate">{title}</p>
          <p className="text-small text-ink-soft truncate mt-1">{meta}</p>
          {(salaryMinUsd || salaryMaxUsd) && (
            <p className="text-small text-accent mt-0.5">
              {salaryMinUsd ? `$${Math.round(salaryMinUsd / 1000)}k` : ""}
              {salaryMinUsd && salaryMaxUsd ? "–" : ""}
              {salaryMaxUsd ? `$${Math.round(salaryMaxUsd / 1000)}k` : ""}
            </p>
          )}
          {publishedDate && (
            <div className="mt-1.5">
              <FreshnessPill publishedDate={publishedDate} compact />
            </div>
          )}
        </div>
        {showScore && (
          <ScoreChip score={score} className="shrink-0 mt-1" />
        )}
      </div>
      {fit && (
        <p className="text-small italic text-success mt-2 leading-snug line-clamp-1" title={fit}>
          {fit}
        </p>
      )}
    </button>
  );
}
