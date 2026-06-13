import { describe, expect, it } from "vitest";
import { countryCodeForLocation, expandCitySynonyms, findCitiesInText, locationMatches } from "@/lib/city-synonyms";

describe("city synonyms", () => {
  it("expands Indian and US metro aliases", () => {
    expect(expandCitySynonyms("Bangalore")).toEqual(expect.arrayContaining(["Bengaluru", "Bangalore", "BLR"]));
    expect(expandCitySynonyms("SF")).toEqual(expect.arrayContaining(["San Francisco", "SF", "Bay Area"]));
  });

  it("matches job locations against any synonym", () => {
    expect(locationMatches("Bengaluru, Karnataka, India", "Bangalore")).toBe(true);
    expect(locationMatches("Gurgaon, HR", "Gurugram")).toBe(true);
    expect(locationMatches("San Francisco Bay Area", "SF")).toBe(true);
    expect(locationMatches("Mumbai, India", "Pune")).toBe(false);
  });

  it("does not match empty job locations for constrained queries", () => {
    expect(locationMatches(null, "Hyderabad")).toBe(false);
    expect(locationMatches("", "Hyderabad")).toBe(false);
  });

  it("finds cities and country codes from text", () => {
    expect(findCitiesInText("roles in Bombay and BLR").map((c) => c.canonical)).toEqual(["Bengaluru", "Mumbai"]);
    expect(countryCodeForLocation("Hyderabad")).toBe("IN");
    expect(countryCodeForLocation("United Kingdom")).toBe("GB");
  });
});
