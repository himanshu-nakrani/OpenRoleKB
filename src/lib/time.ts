export function relativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) return "just now";

  const diffMin = Math.floor(diffMs / (1000 * 60));
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return diffMin + "m ago";

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return diffHours + "h ago";

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "1d ago";
  if (diffDays < 30) return diffDays + "d ago";

  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return diffMonths + "mo ago";

  return Math.floor(diffMonths / 12) + "y ago";
}

export function relativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "1 day ago";
  if (diffDays < 30) return diffDays + " days ago";
  if (diffDays < 365) return Math.floor(diffDays / 30) + " months ago";
  return Math.floor(diffDays / 365) + " years ago";
}
