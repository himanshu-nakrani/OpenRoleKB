import { describe, expect, it } from "vitest";
import { __test__ } from "@/lib/exa";

describe("Exa search params", () => {
  it("uses parsed city/country for userLocation", () => {
    expect(__test__.getUserLocation({ location: "Hyderabad" })).toBe("IN");
    expect(__test__.getUserLocation({ location: "Bangalore" })).toBe("IN");
    expect(__test__.getUserLocation({ location: "London" })).toBe("GB");
    expect(__test__.getUserLocation({ location: "United Kingdom" })).toBe("GB");
  });

  it("omits userLocation for remote-only queries", () => {
    expect(__test__.getUserLocation({ role: "react", remote: true })).toBeUndefined();
  });

  it("defaults to US when no location can be inferred", () => {
    expect(__test__.getUserLocation({ role: "engineer" })).toBe("US");
    expect(__test__.getUserLocation({ location: "Atlantis" })).toBe("US");
  });

  it("omits userLocation for region-hint + remote (no US fallback)", () => {
    expect(__test__.getUserLocation({ location: "EU timezone", remote: true })).toBeUndefined();
    expect(__test__.getUserLocation({ location: "EMEA", remote: true })).toBeUndefined();
    expect(__test__.getUserLocation({ location: "US east coast", remote: true })).toBeUndefined();
  });
});

describe("buildQueryString", () => {
  it("drops region-hint locations from the `in ...` clause", () => {
    const q = __test__.buildQueryString({
      seniority: "senior",
      role: "react engineer",
      location: "EU timezone",
      remote: true,
      exclude: ["crypto"],
    });
    expect(q).not.toMatch(/in EU timezone/i);
    expect(q).toMatch(/remote-friendly/);
    expect(q).toMatch(/-\(crypto\)/);
  });

  it("keeps real city/country locations", () => {
    const q = __test__.buildQueryString({
      role: "engineer",
      location: "Bangalore",
    });
    expect(q).toMatch(/in Bangalore/);
  });
});

describe("isRegionHint", () => {
  it("flags timezone/region phrases", () => {
    expect(__test__.isRegionHint("EU timezone")).toBe(true);
    expect(__test__.isRegionHint("US timezone")).toBe(true);
    expect(__test__.isRegionHint("EMEA")).toBe(true);
    expect(__test__.isRegionHint("APAC")).toBe(true);
    expect(__test__.isRegionHint("LATAM")).toBe(true);
    expect(__test__.isRegionHint("Americas")).toBe(true);
    expect(__test__.isRegionHint("US east coast")).toBe(true);
    expect(__test__.isRegionHint("EU west")).toBe(true);
  });

  it("does not flag real places", () => {
    expect(__test__.isRegionHint("Bangalore")).toBe(false);
    expect(__test__.isRegionHint("San Francisco")).toBe(false);
    expect(__test__.isRegionHint("United Kingdom")).toBe(false);
    expect(__test__.isRegionHint("New York")).toBe(false);
  });
});
