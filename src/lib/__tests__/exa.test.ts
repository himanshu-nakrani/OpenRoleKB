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
});
