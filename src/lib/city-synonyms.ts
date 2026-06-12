export interface CityEntry {
  canonical: string;
  countryCode: string;
  synonyms: string[];
}

export const CITY_SYNONYMS: CityEntry[] = [
  { canonical: "Bengaluru", countryCode: "IN", synonyms: ["Bengaluru", "Bangalore", "BLR"] },
  { canonical: "Gurugram", countryCode: "IN", synonyms: ["Gurugram", "Gurgaon"] },
  { canonical: "Mumbai", countryCode: "IN", synonyms: ["Mumbai", "Bombay"] },
  { canonical: "Delhi", countryCode: "IN", synonyms: ["Delhi", "New Delhi", "NCR", "Noida"] },
  { canonical: "Hyderabad", countryCode: "IN", synonyms: ["Hyderabad", "Hyd"] },
  { canonical: "Chennai", countryCode: "IN", synonyms: ["Chennai", "Madras"] },
  { canonical: "Pune", countryCode: "IN", synonyms: ["Pune"] },
  { canonical: "Kolkata", countryCode: "IN", synonyms: ["Kolkata", "Calcutta"] },
  { canonical: "Ahmedabad", countryCode: "IN", synonyms: ["Ahmedabad", "Amdavad"] },
  { canonical: "Jaipur", countryCode: "IN", synonyms: ["Jaipur"] },
  { canonical: "Kochi", countryCode: "IN", synonyms: ["Kochi", "Cochin"] },
  { canonical: "Indore", countryCode: "IN", synonyms: ["Indore"] },
  { canonical: "Coimbatore", countryCode: "IN", synonyms: ["Coimbatore"] },
  { canonical: "Chandigarh", countryCode: "IN", synonyms: ["Chandigarh", "Mohali"] },
  { canonical: "Thiruvananthapuram", countryCode: "IN", synonyms: ["Thiruvananthapuram", "Trivandrum"] },
  { canonical: "New York", countryCode: "US", synonyms: ["New York", "New York City", "NYC"] },
  { canonical: "San Francisco", countryCode: "US", synonyms: ["San Francisco", "SF", "Bay Area", "San Francisco Bay Area"] },
  { canonical: "Seattle", countryCode: "US", synonyms: ["Seattle"] },
  { canonical: "Austin", countryCode: "US", synonyms: ["Austin"] },
  { canonical: "Boston", countryCode: "US", synonyms: ["Boston"] },
  { canonical: "Los Angeles", countryCode: "US", synonyms: ["Los Angeles", "LA"] },
  { canonical: "Chicago", countryCode: "US", synonyms: ["Chicago"] },
  { canonical: "Atlanta", countryCode: "US", synonyms: ["Atlanta"] },
  { canonical: "Denver", countryCode: "US", synonyms: ["Denver"] },
  { canonical: "Washington", countryCode: "US", synonyms: ["Washington DC", "Washington, DC", "DC"] },
  { canonical: "London", countryCode: "GB", synonyms: ["London"] },
  { canonical: "Manchester", countryCode: "GB", synonyms: ["Manchester"] },
  { canonical: "Toronto", countryCode: "CA", synonyms: ["Toronto"] },
  { canonical: "Vancouver", countryCode: "CA", synonyms: ["Vancouver"] },
  { canonical: "Singapore", countryCode: "SG", synonyms: ["Singapore"] },
  { canonical: "Sydney", countryCode: "AU", synonyms: ["Sydney"] },
  { canonical: "Melbourne", countryCode: "AU", synonyms: ["Melbourne"] },
  { canonical: "Berlin", countryCode: "DE", synonyms: ["Berlin"] },
  { canonical: "Paris", countryCode: "FR", synonyms: ["Paris"] },
  { canonical: "Tokyo", countryCode: "JP", synonyms: ["Tokyo"] },
];

export const COUNTRY_ALIASES: Record<string, string> = {
  india: "IN",
  bharat: "IN",
  in: "IN",
  us: "US",
  usa: "US",
  "u.s.": "US",
  "u.s.a.": "US",
  america: "US",
  "united states": "US",
  uk: "GB",
  "u.k.": "GB",
  gb: "GB",
  britain: "GB",
  "great britain": "GB",
  "united kingdom": "GB",
  canada: "CA",
  ca: "CA",
  singapore: "SG",
  sg: "SG",
  australia: "AU",
  au: "AU",
  germany: "DE",
  de: "DE",
  france: "FR",
  fr: "FR",
  japan: "JP",
  jp: "JP",
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function synonymPattern(synonym: string): RegExp {
  const escaped = escapeRegex(synonym).replace(/\\ /g, "[\\s,-]+");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i");
}

export function expandCitySynonyms(location: string): string[] {
  const normalized = normalizeText(location);
  const matches = CITY_SYNONYMS.filter((entry) =>
    entry.synonyms.some((synonym) => synonymPattern(synonym).test(normalized)),
  );

  if (!matches.length) return [location.trim()].filter(Boolean);

  return Array.from(new Set(matches.flatMap((entry) => entry.synonyms)));
}

export function locationMatches(jobLocation: string | null | undefined, queryLocation: string | undefined): boolean {
  if (!queryLocation?.trim()) return true;
  if (!jobLocation?.trim()) return false;
  const job = normalizeText(jobLocation);
  return expandCitySynonyms(queryLocation).some((synonym) => synonymPattern(synonym).test(job));
}

export function findCitiesInText(text: string): CityEntry[] {
  const normalized = normalizeText(text);
  return CITY_SYNONYMS.filter((entry) =>
    entry.synonyms.some((synonym) => synonymPattern(synonym).test(normalized)),
  );
}

export function countryCodeForLocation(location: string | undefined): string | undefined {
  if (!location?.trim()) return undefined;
  const normalized = normalizeText(location);
  const direct = COUNTRY_ALIASES[normalized];
  if (direct) return direct;
  const city = findCitiesInText(location)[0];
  return city?.countryCode;
}
