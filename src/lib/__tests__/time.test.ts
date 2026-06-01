import { describe, it, expect } from "vitest";
import { relativeTime, relativeDate } from "@/lib/time";

describe("relativeTime", () => {
  it("returns 'just now' for current time", () => {
    const now = new Date().toISOString();
    expect(relativeTime(now)).toBe("just now");
  });

  it("returns minutes ago format", () => {
    const d = new Date(Date.now() - 25 * 60 * 1000).toISOString();
    expect(relativeTime(d)).toBe("25m ago");
  });

  it("returns hours ago format", () => {
    const d = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    expect(relativeTime(d)).toBe("3h ago");
  });

  it("returns days ago format", () => {
    const d = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    expect(relativeTime(d)).toBe("14d ago");
  });

  it("returns '1d ago' for exactly one day", () => {
    const d = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    expect(relativeTime(d)).toBe("1d ago");
  });
});

describe("relativeDate", () => {
  it("returns 'today' for same day", () => {
    const now = new Date().toISOString();
    expect(relativeDate(now)).toBe("today");
  });

  it("returns '1 day ago'", () => {
    const d = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    expect(relativeDate(d)).toBe("1 day ago");
  });

  it("returns plural days", () => {
    const d = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    expect(relativeDate(d)).toBe("5 days ago");
  });
});
