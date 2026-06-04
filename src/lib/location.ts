const LOCATION_RX = /(?:Location|Based in|Office|Working from)\s*[:\-\u2013\u2014]\s*([\p{L}][\p{L}\p{N} ,/&-]{1,60})/iu;
const REMOTE_RX = /\b(fully remote|remote-first|remote\s*[-–]\s*\w+|work from anywhere)\b/i;

export function extractLocation(text: string): { location: string | null; isRemote: boolean } {
  const loc = text.match(LOCATION_RX)?.[1]?.trim() ?? null;
  const isRemote = REMOTE_RX.test(text);
  return { location: loc, isRemote };
}

// Small lookup for common variants -> canonical form (P2 location norm, no NLP)
const LOCATION_NORM: Record<string, string> = {
  sf: "San Francisco, CA",
  "san francisco": "San Francisco, CA",
  "bay area": "San Francisco Bay Area, CA",
  nyc: "New York, NY",
  "new york": "New York, NY",
  "new york city": "New York, NY",
  "ny": "New York, NY",
  la: "Los Angeles, CA",
  "los angeles": "Los Angeles, CA",
  seattle: "Seattle, WA",
  austin: "Austin, TX",
  boston: "Boston, MA",
  chicago: "Chicago, IL",
  london: "London, UK",
  berlin: "Berlin, Germany",
  "remote us": "Remote (US)",
  "remote eu": "Remote (EU)",
};

export function normalizeLocation(loc: string | null): string | null {
  if (!loc) return null;
  const key = loc.toLowerCase().trim().replace(/\s+/g, " ");
  return LOCATION_NORM[key] || loc;
}
