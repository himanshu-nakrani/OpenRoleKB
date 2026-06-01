/**
 * Aurora design tokens — single source of truth.
 *
 * Edit values here, then mirror them in src/app/globals.css (the CSS-variable
 * defaults). Both files MUST stay in sync; the matching is asserted in
 * src/lib/__tests__/tokens.test.ts.
 */

export const palette = {
  light: {
    bg: "#F7F5F2",
    surface: "#FFFFFF",
    surface2: "#EFECE6",
    surface3: "#E4E0D9",
    ink: "#1B1C2A",
    inkSoft: "#51536F",
    muted: "#8588A3",
    border: "#DCD7CE",
    borderStrong: "#B0AAA1",
    accent: "#7C5CFF",
    accentSoft: "#EBE4FF",
    accentDark: "#5B3FE3",
    accentText: "#FFFFFF",
    success: "#10B981",
    successSoft: "#D1FAE5",
    danger: "#EF4858",
    dangerSoft: "#FEE2E2",
    warning: "#F59E0B",
    warningSoft: "#FEF3C7",
    info: "#3B82F6",
    infoSoft: "#DBEAFE",
  },
  dark: {
    bg: "#0C0E16",
    surface: "#14172A",
    surface2: "#1D2138",
    surface3: "#272C47",
    ink: "#ECEBF5",
    inkSoft: "#A6A8C2",
    muted: "#71748E",
    border: "#232742",
    borderStrong: "#353A5C",
    accent: "#A78BFA",
    accentSoft: "#2A2154",
    accentDark: "#8B5CF6",
    accentText: "#0C0A20",
    success: "#6EE7B7",
    successSoft: "#064E3B",
    danger: "#F87171",
    dangerSoft: "#4A1414",
    warning: "#FBBF24",
    warningSoft: "#451A03",
    info: "#60A5FA",
    infoSoft: "#1E3A8A",
  },
} as const;

export const radius = {
  sm: "4px",
  md: "8px",
  lg: "12px",
  xl: "16px",
  full: "999px",
} as const;

export const motion = {
  duration: {
    micro: 120,
    entry: 220,
    exit: 180,
    page: 320,
  },
  easing: {
    micro: "cubic-bezier(0.0, 0.0, 0.2, 1)",
    entry: "cubic-bezier(0.2, 0.6, 0.1, 1)",
    exit: "cubic-bezier(0.6, 0.0, 1.0, 0.0)",
  },
} as const;

export const typography = {
  display: { size: "2.5rem", lineHeight: 1.1, letterSpacing: "-0.02em" },
  h1: { size: "1.625rem", lineHeight: 1.2, letterSpacing: "-0.01em" },
  h2: { size: "1.25rem", lineHeight: 1.3, letterSpacing: "-0.005em" },
  body: { size: "1rem", lineHeight: 1.55 },
  small: { size: "0.875rem", lineHeight: 1.5 },
  micro: { size: "0.75rem", lineHeight: 1.4 },
} as const;

export type PaletteMode = keyof typeof palette;
export type PaletteToken = keyof typeof palette.light;
