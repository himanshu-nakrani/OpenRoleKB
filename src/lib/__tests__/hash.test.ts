import { describe, it, expect } from "vitest";
import { hashQuery, normalizeQuery } from "@/lib/hash";

describe("normalizeQuery", () => {
  it("trims and lowercases", () => {
    expect(normalizeQuery("  React Engineer  ")).toBe("react engineer");
  });

  it("collapses multiple whitespace", () => {
    expect(normalizeQuery("senior   react    developer")).toBe("senior react developer");
  });
});

describe("hashQuery", () => {
  it("same query with different whitespace produces identical hash", () => {
    const a = hashQuery("  React Engineer  ", { role: "react" });
    const b = hashQuery("react engineer", { role: "react" });
    expect(a).toBe(b);
  });

  it("same query with different case produces identical hash", () => {
    const a = hashQuery("React Engineer", { role: "react" });
    const b = hashQuery("react engineer", { role: "react" });
    expect(a).toBe(b);
  });

  it("filters with keys in different order produce identical hashes (canonicalized)", () => {
    const a = hashQuery("react remote", { role: "react", remote: true });
    const b = hashQuery("react remote", { remote: true, role: "react" });
    expect(a).toBe(b);
  });

  it("different query produces different hash", () => {
    const a = hashQuery("react engineer", {});
    const b = hashQuery("python developer", {});
    expect(a).not.toBe(b);
  });

  it("different filters produce different hash", () => {
    const a = hashQuery("react", { remote: true });
    const b = hashQuery("react", { remote: false });
    expect(a).not.toBe(b);
  });

  it("empty filters produce consistent hash", () => {
    const a = hashQuery("query", {});
    const b = hashQuery("query", {});
    expect(a).toBe(b);
  });

  it("produces a 64-char hex string", () => {
    const h = hashQuery("test", { role: "engineer" });
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });
});
