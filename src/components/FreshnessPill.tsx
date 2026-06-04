"use client";

import { FRESHNESS_WEEK_DAYS } from "@/lib/config";

interface FreshnessPillProps {
  publishedDate?: string | null;
  /** Compact: shows just the label. Otherwise prepends a dot indicator. */
  compact?: boolean;
  className?: string;
}

type Tier = "fresh" | "recent" | "aging" | "stale" | "ancient";

interface TierStyle {
  label: string;
  classes: string;
  /** Title attribute for hover/screen reader; the full sentence. */
  title: string;
}

function classify(publishedDate: string): { tier: Tier; days: number } | null {
  const parsed = new Date(publishedDate);
  if (Number.isNaN(parsed.getTime())) return null;
  const ageMs = Date.now() - parsed.getTime();
  if (ageMs < 0) return { tier: "fresh", days: 0 };
  const days = Math.floor(ageMs / (1000 * 60 * 60 * 24));
  if (days < FRESHNESS_WEEK_DAYS) return { tier: "fresh", days };
  if (days < 21) return { tier: "recent", days };
  if (days < 60) return { tier: "aging", days };
  if (days < 120) return { tier: "stale", days };
  return { tier: "ancient", days };
}

function styleFor(tier: Tier, days: number): TierStyle {
  // Label rules
  let label: string;
  if (days === 0) label = "today";
  else if (days < FRESHNESS_WEEK_DAYS) label = `${days}d ago`;
  else if (days < 30) label = `${Math.floor(days / 7)}w ago`;
  else if (days < 365) label = `${Math.floor(days / 30)}mo ago`;
  else label = `${Math.floor(days / 365)}y ago`;

  const titleBase = days === 0 ? "Posted today" : `Posted ${label}`;

  switch (tier) {
    case "fresh":
      return {
        label,
        classes: "bg-success/12 text-success border-success/20",
        title: `${titleBase} · fresh listing`,
      };
    case "recent":
      return {
        label,
        classes: "bg-surface-2 text-ink-soft border-border",
        title: titleBase,
      };
    case "aging":
      return {
        label,
        classes: "bg-warning/12 text-warning border-warning/20",
        title: `${titleBase} · over a month old`,
      };
    case "stale":
      return {
        label,
        classes: "bg-danger/10 text-danger border-danger/20",
        title: `${titleBase} · may no longer be open`,
      };
    case "ancient":
      return {
        label,
        classes: "bg-danger/10 text-danger border-danger/20",
        title: `${titleBase} · very likely closed`,
      };
  }
}

export function FreshnessPill({ publishedDate, compact, className = "" }: FreshnessPillProps) {
  if (!publishedDate) return null;
  const cls = classify(publishedDate);
  if (!cls) return null;
  const style = styleFor(cls.tier, cls.days);

  return (
    <span
      title={style.title}
      aria-label={style.title}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-micro font-medium ${style.classes} ${className}`}
    >
      {!compact && (
        <span
          aria-hidden
          className={`w-1.5 h-1.5 rounded-full ${
            cls.tier === "fresh"
              ? "bg-success"
              : cls.tier === "aging"
                ? "bg-warning"
                : cls.tier === "stale" || cls.tier === "ancient"
                  ? "bg-danger"
                  : "bg-ink-soft/40"
          }`}
        />
      )}
      {style.label}
    </span>
  );
}

// Exported for tests + the "Posted this week" filter chip (see ResultsList).
export function isWithinDays(publishedDate: string | null | undefined, days: number): boolean {
  if (!publishedDate) return false;
  const parsed = new Date(publishedDate);
  if (Number.isNaN(parsed.getTime())) return false;
  const ageDays = (Date.now() - parsed.getTime()) / (1000 * 60 * 60 * 24);
  return ageDays >= 0 && ageDays < days;
}
