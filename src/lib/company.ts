export function extractCompany(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const path = u.pathname.split("/").filter(Boolean);

    if (host.endsWith("greenhouse.io") && path[0]) return path[0];
    if (host === "jobs.lever.co" && path[0]) return path[0];
    if (host === "jobs.ashbyhq.com" && path[0]) return path[0];
    if (host === "apply.workable.com" && path[0]) return path[0];

    return null;
  } catch {
    return null;
  }
}
