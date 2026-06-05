"use client";

import { useEffect, useState } from "react";

/**
 * Non-interactive demo of what a real search produces. Cycles through 3
 * canned queries with synthetic results. Pure aesthetic — never makes a
 * network request. Used on the empty-state landing to anchor the value
 * prop visually next to the real SearchBox.
 *
 * Hydration: server render emits the first scene statically. The interval
 * starts after mount so SSR HTML is stable.
 */

type Result = {
  title: string;
  company: string;
  score: number;
  tag: string;
};

type Scene = {
  query: string;
  results: Result[];
};

const SCENES: Scene[] = [
  {
    query: "senior react, remote EU, no crypto",
    results: [
      { title: "Senior React Engineer", company: "Acme",       score: 92, tag: "EU · Remote" },
      { title: "Frontend Engineer",     company: "Superhuman", score: 87, tag: "EU · Remote" },
      { title: "Staff React Engineer",  company: "Linear",     score: 81, tag: "EU · Hybrid" },
      { title: "Senior Frontend",       company: "Cron",       score: 74, tag: "EU · Remote" },
      { title: "React Lead",            company: "Vercel",     score: 69, tag: "EU · Remote" },
    ],
  },
  {
    query: "junior product manager, fintech, NYC",
    results: [
      { title: "Associate Product Manager", company: "Mercury", score: 89, tag: "NYC · Onsite" },
      { title: "APM, Payments",             company: "Stripe",  score: 84, tag: "NYC · Hybrid" },
      { title: "Junior PM, Lending",        company: "Plaid",   score: 78, tag: "NYC · Hybrid" },
      { title: "Product Manager I",         company: "Brex",    score: 72, tag: "NYC · Remote" },
      { title: "APM, Risk",                 company: "Ramp",    score: 67, tag: "NYC · Hybrid" },
    ],
  },
  {
    query: "staff python, ML, San Francisco",
    results: [
      { title: "Staff ML Engineer",       company: "Anthropic", score: 94, tag: "SF · Onsite" },
      { title: "Principal Python Eng",    company: "OpenAI",    score: 88, tag: "SF · Hybrid" },
      { title: "Staff Engineer, ML",      company: "Scale",     score: 82, tag: "SF · Onsite" },
      { title: "ML Platform Lead",        company: "Databricks", score: 76, tag: "SF · Hybrid" },
      { title: "Staff SWE, Inference",    company: "Together",  score: 71, tag: "SF · Remote" },
    ],
  },
];

const SCENE_MS = 6500;

export function DemoLoop() {
  const [sceneIdx, setSceneIdx] = useState(0);
  const [phase, setPhase] = useState<"typing" | "results">("typing");

  useEffect(() => {
    let typingTimer: number | undefined;
    let advanceTimer: number | undefined;

    function runScene() {
      setPhase("typing");
      typingTimer = window.setTimeout(() => setPhase("results"), 1400);
      advanceTimer = window.setTimeout(() => {
        setSceneIdx((i) => (i + 1) % SCENES.length);
      }, SCENE_MS);
    }

    runScene();
    return () => {
      if (typingTimer) window.clearTimeout(typingTimer);
      if (advanceTimer) window.clearTimeout(advanceTimer);
    };
  }, [sceneIdx]);

  const scene = SCENES[sceneIdx];

  return (
    <div
      aria-hidden
      className="rounded-2xl border border-border bg-surface/80 backdrop-blur-sm shadow-card overflow-hidden"
    >
      {/* Faux browser chrome */}
      <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-border bg-surface-2/70">
        <span className="w-2.5 h-2.5 rounded-full bg-ink-soft/30" />
        <span className="w-2.5 h-2.5 rounded-full bg-ink-soft/20" />
        <span className="w-2.5 h-2.5 rounded-full bg-ink-soft/30" />
        <span className="ml-3 text-micro text-muted font-mono">openrolekb.app</span>
      </div>

      {/* Query bar */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center gap-2.5 h-10 px-4 rounded-full bg-surface-2/80 border border-border">
          <span className="text-ink-soft text-small">🔍</span>
          <span className="text-small text-ink font-mono">
            {scene.query}
            <span
              className={
                "inline-block w-[1px] h-3.5 ml-0.5 bg-ink align-middle " +
                (phase === "typing" ? "animate-pulse" : "opacity-0")
              }
            />
          </span>
        </div>
      </div>

      {/* Results */}
      <div className="px-4 pb-4 space-y-1.5">
        {scene.results.map((r, i) => (
          <div
            key={`${sceneIdx}-${i}`}
            className={
              "flex items-center gap-3 px-3 py-2 rounded-lg border border-border/60 bg-surface " +
              (phase === "results" ? "animate-fade-in" : "opacity-30")
            }
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <ScoreBubble score={r.score} />
            <div className="flex-1 min-w-0">
              <p className="text-small font-medium text-ink truncate">{r.title}</p>
              <p className="text-micro text-muted truncate">
                {r.company} · {r.tag}
              </p>
            </div>
            <span className="text-micro text-muted whitespace-nowrap">▸</span>
          </div>
        ))}
      </div>

      {/* Scene pips */}
      <div className="px-4 pb-4 flex items-center justify-center gap-1.5">
        {SCENES.map((_, i) => (
          <span
            key={i}
            className={
              "h-1 rounded-full transition-all duration-300 " +
              (i === sceneIdx ? "w-6 bg-accent" : "w-1.5 bg-ink-soft/25")
            }
          />
        ))}
      </div>
    </div>
  );
}

function ScoreBubble({ score }: { score: number }) {
  const tone =
    score >= 85 ? "bg-accent-soft text-accent-dark"
    : score >= 70 ? "bg-success/15 text-success"
    : "bg-surface-2 text-ink-soft";
  return (
    <span className={"inline-flex items-center justify-center w-9 h-9 rounded-full text-micro font-semibold tabular-nums " + tone}>
      {score}
    </span>
  );
}
