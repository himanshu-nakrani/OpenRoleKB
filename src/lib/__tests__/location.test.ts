import { describe, it, expect } from "vitest";
import { extractLocation } from "@/lib/location";

describe("extractLocation", () => {
  it("extracts location from 'Location: Berlin'", () => {
    const r = extractLocation("Some job desc\nLocation: Berlin\nMore text");
    expect(r.location).toBe("Berlin");
    expect(r.isRemote).toBe(false);
  });

  it("extracts location from 'Based in: San Francisco, CA'", () => {
    const r = extractLocation("Requirements etc. Based in: San Francisco, CA. Remote ok.");
    expect(r.location).toBe("San Francisco, CA");
  });

  it("extracts location from 'Office: London'", () => {
    const r = extractLocation("Office: London\nSalary: £80k");
    expect(r.location).toBe("London");
  });

  it("detects 'fully remote' as remote", () => {
    const r = extractLocation("Fully remote position, worldwide.");
    expect(r.isRemote).toBe(true);
  });

  it("detects 'remote-first' as remote", () => {
    const r = extractLocation("We are a remote-first company.");
    expect(r.isRemote).toBe(true);
  });

  it("detects 'work from anywhere' as remote", () => {
    const r = extractLocation("Work from anywhere in the EU.");
    expect(r.isRemote).toBe(true);
  });

  it("returns null location when none found", () => {
    const r = extractLocation("Just a job description.");
    expect(r.location).toBeNull();
  });

  it("extracts lowercase location", () => {
    const r = extractLocation("location: san francisco");
    expect(r.location).toBe("san francisco");
  });

  it("extracts unicode location names", () => {
    const r = extractLocation("Office: Zürich");
    expect(r.location).toBe("Zürich");
  });
});
