import { describe, it, expect } from "vitest";
import { isWithinDays } from "@/components/FreshnessPill";

// Boundary tests for the freshness predicate.
// The pill's component-level rendering is unit-tested implicitly by its
// callers — these tests pin down the date math so tier boundaries don't
// drift silently.

const DAY = 1000 * 60 * 60 * 24;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

describe("isWithinDays", () => {
  it("returns false for null / undefined / empty / invalid", () => {
    expect(isWithinDays(null, 7)).toBe(false);
    expect(isWithinDays(undefined, 7)).toBe(false);
    expect(isWithinDays("", 7)).toBe(false);
    expect(isWithinDays("not-a-date", 7)).toBe(false);
  });

  it("returns true for dates within the window", () => {
    expect(isWithinDays(daysAgo(0), 7)).toBe(true);
    expect(isWithinDays(daysAgo(3), 7)).toBe(true);
    expect(isWithinDays(daysAgo(6), 7)).toBe(true);
  });

  it("returns false on the boundary (strict <)", () => {
    // exactly 7 days old → not within "this week"
    expect(isWithinDays(daysAgo(7), 7)).toBe(false);
  });

  it("returns false for future dates (clock skew)", () => {
    const future = new Date(Date.now() + DAY).toISOString();
    expect(isWithinDays(future, 7)).toBe(false);
  });

  it("scales window correctly", () => {
    expect(isWithinDays(daysAgo(20), 30)).toBe(true);
    expect(isWithinDays(daysAgo(30), 30)).toBe(false);
    expect(isWithinDays(daysAgo(90), 30)).toBe(false);
  });
});
