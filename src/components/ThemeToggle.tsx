"use client";

import { useState, useEffect } from "react";
import { SunMoon, Sun, Moon } from "lucide-react";

type Theme = "system" | "light" | "dark";
const KEY = "openrolekb_theme";

function readTheme(): Theme {
  if (typeof window === "undefined") return "system";
  return (localStorage.getItem(KEY) as Theme) || "system";
}

function applyTheme(theme: Theme) {
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

const Icons: Record<Theme, React.ComponentType<{ size?: number; strokeWidth?: number }>> = {
  system: SunMoon,
  light: Sun,
  dark: Moon,
};

const labels: Record<Theme, string> = {
  system: "System theme",
  light: "Light theme",
  dark: "Dark theme",
};

const next: Record<Theme, Theme> = {
  system: "light",
  light: "dark",
  dark: "system",
};

export function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => readTheme());

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time mount sync
    setMounted(true);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    function handleChange() {
      const stored = readTheme();
      if (stored === "system") applyTheme("system");
    }
    mq.addEventListener("change", handleChange);
    return () => mq.removeEventListener("change", handleChange);
  }, []);

  function cycle() {
    const t = next[theme];
    setTheme(t);
    localStorage.setItem(KEY, t);
    applyTheme(t);
  }

  return (
    <button
      onClick={cycle}
      aria-label={mounted ? labels[theme] : "Theme"}
      title={mounted ? labels[theme] : "Theme"}
      className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-surface-2 transition-colors duration-120"
    >
      {(() => {
        const Icon = mounted ? Icons[theme] : SunMoon;
        return <Icon size={16} strokeWidth={1.5} />;
      })()}
    </button>
  );
}
