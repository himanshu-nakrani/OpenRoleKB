const LOCATION_RX = /(?:Location|Based in|Office|Working from)\s*[:\-\u2013\u2014]\s*([\p{L}][\p{L}\p{N} ,/&-]{1,60})/iu;
const REMOTE_RX = /\b(fully remote|remote-first|remote\s*[-–]\s*\w+|work from anywhere)\b/i;

export function extractLocation(text: string): { location: string | null; isRemote: boolean } {
  const loc = text.match(LOCATION_RX)?.[1]?.trim() ?? null;
  const isRemote = REMOTE_RX.test(text);
  return { location: loc, isRemote };
}
