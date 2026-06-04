export function extractSalary(text: string): { min?: number; max?: number; raw?: string } {
  if (!text) return {};
  // Support $, €, £ ; optional k/K ; ranges with - – — to
  const rx = /(?:\$|€|£)\s*(\d+(?:,\d{3})*)\s*(k|K)?(?:\s*(?:-|–|—|to)\s*(?:\$|€|£)?\s*(\d+(?:,\d{3})*)\s*(k|K)?)?/gi;
  let match;
  let best: { min?: number; max?: number; raw?: string } = {};
  while ((match = rx.exec(text)) !== null) {
    const raw = match[0];
    let min = parseInt(match[1].replace(/,/g, ''), 10);
    if (match[2]) min *= 1000;
    let max = match[3] ? parseInt(match[3].replace(/,/g, ''), 10) : undefined;
    if (max && match[4]) max *= 1000;
    if (!best.raw || raw.length > (best.raw?.length || 0)) {
      // Heuristic: prefer likely annual salaries (has k, or >=50k implied, or context words)
      const context = raw + (text.substring(match.index, match.index + 30) || "");
      const looksAnnual = /k|K|annual|year|yr|\/yr|\/year/i.test(context) || min >= 50;
      if (looksAnnual) {
        best = { min, max, raw };
      }
    }
  }
  return best;
}
