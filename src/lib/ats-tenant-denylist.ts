/**
 * Slugs that public ATS discovery surfaces but that aren't real customer
 * tenants — vendor demos, internal test accounts, etc. Discovered tenants
 * matching these are skipped at ingest time and marked dead by verify.
 *
 * Keyed by ATS, lowercased.
 */
export const ATS_TENANT_DENYLIST: Record<string, ReadonlySet<string>> = {
  lever: new Set([
    "leverdemo-8",       // Lever's public demo tenant (429 noise jobs)
    "leverdemo",
  ]),
  greenhouse: new Set([
    "greenhousedemo",
    "demo",
  ]),
  ashby: new Set([
    "ashby",             // Ashby's own corp listing — ATS vendor itself; not noise but separate from the discovery flow
  ]),
  smartrecruiters: new Set([
    "oneclick-ui",       // SR landing-page artifact, 0 jobs
    "smart4talent1",     // SR demo-ish single-job account
    "dev2",              // SR internal-looking
    "smartrecruiters",   // SR's own corp listing
  ]),
};

export function isDenylistedTenant(ats: string, slug: string): boolean {
  const set = ATS_TENANT_DENYLIST[ats];
  if (!set) return false;
  return set.has(slug.toLowerCase());
}
