import { describe, it, expect } from "vitest";
import { extractSalary } from "../salary";

describe("extractSalary — INR", () => {
  it("parses bare LPA amount", () => {
    const result = extractSalary("12 LPA");
    expect(result.min).toBe(14400); // 12 * 100_000 * 0.012
    expect(result.max).toBeUndefined();
    expect(result.raw).toBe("12 LPA");
  });

  it("parses ₹-prefixed LPA range", () => {
    const result = extractSalary("₹15-25 LPA");
    expect(result.min).toBe(18000); // 15 * 100_000 * 0.012
    expect(result.max).toBe(30000); // 25 * 100_000 * 0.012
    expect(result.raw).toBe("₹15-25 LPA");
  });

  it("parses Rs crore single value", () => {
    const result = extractSalary("Rs 1.5 crore");
    expect(result.min).toBe(180000); // 1.5 * 10_000_000 * 0.012
    expect(result.max).toBeUndefined();
    expect(result.raw).toContain("1.5 crore");
  });

  it("parses INR with Indian comma formatting", () => {
    // 12,00,000 INR = 1,200,000 INR = 12 lakhs
    const result = extractSalary("INR 12,00,000");
    expect(result.min).toBe(14400); // 1_200_000 * 0.012
    expect(result.raw).toContain("12,00,000");
  });

  it("parses L shorthand range (8L - 14L)", () => {
    const result = extractSalary("8L - 14L");
    expect(result.min).toBe(9600); // 8 * 100_000 * 0.012
    expect(result.max).toBe(16800); // 14 * 100_000 * 0.012
    expect(result.raw).toBe("8L - 14L");
  });

  it("parses a salary embedded in a sentence", () => {
    const result = extractSalary("Compensation: ₹20 LPA - ₹30 LPA based on experience");
    expect(result.min).toBe(24000); // 20 * 100_000 * 0.012
    expect(result.max).toBe(36000); // 30 * 100_000 * 0.012
  });
});

describe("extractSalary — USD (regression)", () => {
  it("still parses USD range with k suffix", () => {
    const result = extractSalary("$120k - $180k");
    expect(result.min).toBe(120000);
    expect(result.max).toBe(180000);
    expect(result.raw).toBe("$120k - $180k");
  });

  it("still parses USD single value", () => {
    const result = extractSalary("Salary: $200,000 per year");
    expect(result.min).toBe(200000);
  });

  it("returns empty for text with no salary", () => {
    const result = extractSalary("No compensation info here.");
    expect(result).toEqual({});
  });
});
