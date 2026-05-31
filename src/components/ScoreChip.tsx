"use client";

interface ScoreChipProps {
  score?: number;
  pulse?: boolean;
  className?: string;
}

export function ScoreChip({ score, pulse = false, className = "" }: ScoreChipProps) {
  if (pulse) {
    return (
      <span
        className={`inline-flex items-center px-2 py-0.5 text-micro font-medium rounded-full bg-surface-2 text-ink-soft ${className}`}
        aria-label="Scoring in progress"
      >
        <span className="w-2 h-2 rounded-full bg-accent animate-breathe" />
      </span>
    );
  }

  if (score === undefined || score < 0.4) return null;

  const pct = Math.round(score * 100);
  const label = `${pct}% match`;

  let bg = "bg-surface-2";
  let text = "text-ink-soft";
  if (score >= 0.85) {
    bg = "bg-accent-soft text-accent-dark";
    text = "";
  } else if (score >= 0.65) {
    bg = "bg-surface-2";
    text = "text-ink";
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-micro font-medium rounded-full ${bg} ${text} ${className}`}
      aria-label={label}
    >
      {score >= 0.85 && <span className="w-1.5 h-1.5 rounded-full bg-accent-dark shrink-0" aria-hidden="true" />}
      {pct}%
    </span>
  );
}
