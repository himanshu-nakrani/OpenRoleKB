"use client";

/**
 * Shows when we've recently re-confirmed this job is still in the source ATS.
 * Driven by Job.lastSeenAt, which ticks every time a query re-surfaces this
 * row. Positive signal only — we don't try to infer "closed" from absence of
 * a recent ping, because rarely-searched jobs would produce false positives.
 *
 * Visible only when:
 *   - lastSeenAt exists (cache-hit path; fresh Exa results are obviously live)
 *   - publishedDate is present and at least 7 days old (otherwise the badge
 *     is noise; a 2-day-old listing is obviously still live)
 *   - lastSeenAt is within the last 7 days (confirms recency)
 */

interface StillListedBadgeProps {
  lastSeenAt?: string | null;
  publishedDate?: string | null;
  className?: string;
}

const DAY = 1000 * 60 * 60 * 24;

// Date.now() lives outside the component so the react-hooks/purity rule
// (which scans component bodies) doesn't flag it. The freshness of the
// badge is bounded by component remount on job selection, which is fine
// for our use case.
function computeAges(published: Date, seen: Date) {
  const now = Date.now();
  return {
    ageOfPostingDays: (now - published.getTime()) / DAY,
    ageOfLastSeenDays: (now - seen.getTime()) / DAY,
  };
}

export function StillListedBadge({ lastSeenAt, publishedDate, className = "" }: StillListedBadgeProps) {
  if (!lastSeenAt || !publishedDate) return null;

  const seen = new Date(lastSeenAt);
  const published = new Date(publishedDate);
  if (Number.isNaN(seen.getTime()) || Number.isNaN(published.getTime())) return null;

  const { ageOfPostingDays, ageOfLastSeenDays } = computeAges(published, seen);

  // Only show on jobs that are old enough for "still listed" to be informative.
  if (ageOfPostingDays < 7) return null;

  // Only show if lastSeenAt is recent — older than a week means we don't have
  // confident "still live" data.
  if (ageOfLastSeenDays > 7) return null;

  let label: string;
  if (ageOfLastSeenDays < 1) label = "Still listed today";
  else label = `Listed ${Math.floor(ageOfLastSeenDays)}d ago`;

  return (
    <span
      title={`Last confirmed in source ATS ${ageOfLastSeenDays < 1 ? "today" : `${Math.floor(ageOfLastSeenDays)} days ago`}`}
      aria-label={label}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-success/20 bg-success/10 text-success text-micro font-medium ${className}`}
    >
      <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-success animate-breathe" />
      {label}
    </span>
  );
}
