// INR → USD conversion constant.
// Rough estimate for 2026: ~83 INR/USD, so 1 INR ≈ 0.012 USD.
// Refresh quarterly: last updated 2026-06-09.
const INR_TO_USD = 0.012;

const LAKH = 100_000;
const CRORE = 10_000_000;

/**
 * Parse an INR amount string like "12 LPA", "₹15-25 LPA", "Rs 1.5 crore",
 * "INR 12,00,000", "8L - 14L". Returns the value in INR.
 * Returns null if no recognizable pattern is found.
 */
function parseInrAmount(s: string): number | null {
  // Normalize commas and whitespace
  const clean = s.replace(/,/g, "").trim();

  // Match numbers like 1.5, 12, 120 (optional decimal)
  const numRx = /(\d+(?:\.\d+)?)/;

  // Crore: "1.5 crore", "1.5cr", "1.5C"
  const croreMatch = clean.match(new RegExp(`^${numRx.source}\\s*(?:crore|cr\\b|C\\b)`, "i"));
  if (croreMatch) return parseFloat(croreMatch[1]) * CRORE;

  // Lakh / LPA / L: "12 LPA", "12 lakh", "12L", "12.5L"
  const lakhMatch = clean.match(
    new RegExp(`^${numRx.source}\\s*(?:lpa|lakh|l\\b)`, "i"),
  );
  if (lakhMatch) return parseFloat(lakhMatch[1]) * LAKH;

  // Plain number (used when prefix/unit already established externally)
  const plainMatch = clean.match(/^(\d+(?:\.\d+)?)$/);
  if (plainMatch) return parseFloat(plainMatch[1]);

  return null;
}

/**
 * Extract an INR salary range from free text.
 * Returns { min, max, raw } in USD (rounded to nearest USD), or {} if none found.
 */
function extractInrSalary(text: string): { min?: number; max?: number; raw?: string } {
  // Patterns we want to recognize (case-insensitive):
  //   ₹12 lakh | ₹12L | Rs. 12 LPA | INR 1,200,000 | 12 LPA | ₹1.5 crore
  //   Ranges: 12-18 LPA | ₹15-25 LPA | Rs 8L - 14L | 8L to 14L

  // Strategy: find a "salary block" that contains INR signals, then extract
  // the leading number(s) and unit.
  const inrSignal = /(?:₹|rs\.?\s*|inr\s*|\binr\b)/i;
  const unitSignal = /(?:lpa|lakh|crore|cr\b|\bL\b)/i;

  // We look for patterns anchored by an INR prefix OR a unit suffix.
  // Regex groups: [prefix?] [num1] [unit?] [sep?] [prefix?] [num2] [unit?]
  const rx =
    /(?:₹|Rs\.?\s*|INR\s*)?\s*(\d+(?:\.\d+)?)\s*(?:,\d{2,3})*\s*(lakh|lpa|crore|cr\b|L\b)?\s*(?:[-–—]|to)\s*(?:₹|Rs\.?\s*|INR\s*)?(\d+(?:\.\d+)?)\s*(?:,\d{2,3})*\s*(lakh|lpa|crore|cr\b|L\b)?|(?:₹|Rs\.?\s*|INR\s*)\s*(\d+(?:,\d{2,3})*(?:\.\d+)?)\s*(lakh|lpa|crore|cr\b|L\b)?|(\d+(?:\.\d+)?)\s*(lakh|lpa|crore|cr\b|L\b)/gi;

  let match: RegExpExecArray | null;
  let best: { min?: number; max?: number; raw?: string } = {};

  while ((match = rx.exec(text)) !== null) {
    const raw = match[0].trim();
    let minInr: number | undefined;
    let maxInr: number | undefined;

    if (match[1] !== undefined) {
      // Range match
      const num1 = parseFloat(match[1].replace(/,/g, ""));
      const unit1 = match[2]?.toLowerCase();
      const num2 = parseFloat(match[3].replace(/,/g, ""));
      const unit2 = match[4]?.toLowerCase();

      const mult1 = unit1 === "crore" || unit1 === "cr" ? CRORE : LAKH;
      const mult2 = unit2
        ? unit2 === "crore" || unit2 === "cr"
          ? CRORE
          : LAKH
        : mult1; // inherit unit from left side

      minInr = num1 * mult1;
      maxInr = num2 * mult2;
    } else if (match[5] !== undefined) {
      // Prefixed single value: ₹12 lakh or Rs. 12,00,000 (plain number)
      const numStr = match[5].replace(/,/g, "");
      const num = parseFloat(numStr);
      const unit = match[6]?.toLowerCase();
      if (unit === "crore" || unit === "cr") {
        minInr = num * CRORE;
      } else if (unit === "lakh" || unit === "lpa" || unit === "l") {
        minInr = num * LAKH;
      } else {
        // Bare number with INR prefix — treat as raw INR rupees
        minInr = num;
      }
    } else if (match[7] !== undefined) {
      // Unit-suffixed value without INR prefix: "12 LPA", "1.5 crore"
      const num = parseFloat(match[7]);
      const unit = match[8]?.toLowerCase();
      // Only accept if there's a recognizable unit — bare numbers are too ambiguous
      if (!unit) continue;
      if (unit === "crore" || unit === "cr") {
        minInr = num * CRORE;
      } else if (unit === "lakh" || unit === "lpa" || unit === "l") {
        minInr = num * LAKH;
      } else {
        continue;
      }
    } else {
      continue;
    }

    // Sanity check: INR annual salaries are rarely below 1 lakh or above 50 crore
    if (minInr !== undefined && (minInr < 50_000 || minInr > 500_000_000)) continue;

    // Convert to USD
    const minUsd = minInr !== undefined ? Math.round(minInr * INR_TO_USD) : undefined;
    const maxUsd = maxInr !== undefined ? Math.round(maxInr * INR_TO_USD) : undefined;

    if (!best.raw || raw.length > (best.raw?.length ?? 0)) {
      best = { min: minUsd, max: maxUsd, raw };
    }
  }

  return best;
}

export function extractSalary(text: string): { min?: number; max?: number; raw?: string } {
  if (!text) return {};

  // --- INR detection (try first so we don't conflate with USD) ---
  // Look for ₹, Rs prefix, INR prefix, or a numeric+unit like "12 LPA", "8L", "1.5 crore"
  const hasInrSignal =
    /₹|Rs\.?\s*\d|INR\s*\d|\d+(?:\.\d+)?\s*(?:LPA|lakh|crore)\b|\d+(?:\.\d+)?\s*L\b/i.test(text);
  if (hasInrSignal) {
    const inr = extractInrSalary(text);
    if (inr.raw) return inr;
  }

  // --- USD / EUR / GBP detection ---
  // Support $, €, £ ; optional k/K ; ranges with - – — to
  const rx =
    /(?:\$|€|£)\s*(\d+(?:,\d{3})*)\s*(k|K)?(?:\s*(?:-|–|—|to)\s*(?:\$|€|£)?\s*(\d+(?:,\d{3})*)\s*(k|K)?)?/gi;
  let match;
  let best: { min?: number; max?: number; raw?: string } = {};
  while ((match = rx.exec(text)) !== null) {
    const raw = match[0];
    let min = parseInt(match[1].replace(/,/g, ""), 10);
    if (match[2]) min *= 1000;
    let max = match[3] ? parseInt(match[3].replace(/,/g, ""), 10) : undefined;
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
