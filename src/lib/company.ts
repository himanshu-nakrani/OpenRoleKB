export function extractCompany(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const path = u.pathname.split("/").filter(Boolean);

    if (host.endsWith("greenhouse.io") && path[0]) {
      if (path[0].toLowerCase() === "embed") {
        return u.searchParams.get("for");
      }
      return path[0];
    }
    if (host === "jobs.lever.co" && path[0]) return path[0];
    if (host === "jobs.ashbyhq.com" && path[0]) return path[0];
    if (host === "apply.workable.com" && path[0]) return path[0];

    // New ATS hosts (Phase 7)
    if (host.endsWith("myworkdayjobs.com")) {
      const match = host.match(/^([^.]+)\.myworkdayjobs\.com$/);
      return match ? match[1] : null;
    }
    if (host.endsWith("smartrecruiters.com")) {
      if (path[0] && path[0].toLowerCase() !== "careers") return path[0];
      const match = host.match(/^([^.]+)\.smartrecruiters\.com$/);
      return match ? match[1] : null;
    }
    if (host.endsWith("bamboohr.com")) {
      const match = host.match(/^([^.]+)\.bamboohr\.com$/);
      return match ? match[1] : (path[0] || null);
    }
    if (host.endsWith("recruitee.com")) {
      const match = host.match(/^([^.]+)\.recruitee\.com$/);
      return match ? match[1] : null;
    }
    if (host.endsWith("personio.de")) {
      const match = host.match(/^([^.]+)\.personio\.de$/);
      if (match) return match[1];
      if (path[0]) return path[0];
      return null;
    }
    if (host.endsWith("teamtailor.com")) {
      const match = host.match(/^((?:[^.]+\.)?([^.]+))\.teamtailor\.com$/);
      if (match) return match[2];
      return null;
    }

    return null;
  } catch {
    return null;
  }
}
