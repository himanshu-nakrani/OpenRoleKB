import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { palette } from "@/lib/tokens";

const css = readFileSync(resolve(__dirname, "../../app/globals.css"), "utf-8");

function extractBlock(selector: string): Record<string, string> {
  const rx = new RegExp(`${selector.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*{([^}]+)}`);
  const match = css.match(rx);
  if (!match) throw new Error(`Block ${selector} not found in globals.css`);
  const block = match[1];
  const vars: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const m = line.match(/--([a-z0-9-]+)\s*:\s*([^;]+);/i);
    if (m) vars[m[1]] = m[2].trim();
  }
  return vars;
}

const tokenToVar: Record<keyof typeof palette.light, string> = {
  bg: "bg",
  surface: "surface",
  surface2: "surface-2",
  surface3: "surface-3",
  ink: "ink",
  inkSoft: "ink-soft",
  muted: "muted",
  border: "border",
  borderStrong: "border-strong",
  accent: "accent",
  accentSoft: "accent-soft",
  accentDark: "accent-dark",
  accentText: "accent-text",
  success: "success",
  successSoft: "success-soft",
  danger: "danger",
  dangerSoft: "danger-soft",
  warning: "warning",
  warningSoft: "warning-soft",
  info: "info",
  infoSoft: "info-soft",
};

// Tokens that don't (yet) have a CSS variable counterpart — skipped from the sync check.
// Keep this empty unless you're intentionally leaving a token JS-only.
const cssOnlyExempt = new Set<string>([
  "success-soft",
  "danger-soft",
  "warning",
  "warning-soft",
  "info",
  "info-soft",
]);

describe("design tokens stay in sync with globals.css", () => {
  it("light palette matches :root variables (or is exempt)", () => {
    const root = extractBlock(":root");
    for (const [tokenKey, value] of Object.entries(palette.light)) {
      const cssVar = tokenToVar[tokenKey as keyof typeof palette.light];
      if (cssOnlyExempt.has(cssVar)) continue;
      expect(root[cssVar]?.toUpperCase()).toBe(value.toUpperCase());
    }
  });

  it("dark palette matches .dark variables (or is exempt)", () => {
    const dark = extractBlock(".dark");
    for (const [tokenKey, value] of Object.entries(palette.dark)) {
      const cssVar = tokenToVar[tokenKey as keyof typeof palette.dark];
      if (cssOnlyExempt.has(cssVar)) continue;
      expect(dark[cssVar]?.toUpperCase()).toBe(value.toUpperCase());
    }
  });
});
