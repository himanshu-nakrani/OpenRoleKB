"use client";

import { ExternalLink } from "lucide-react";
import { ScoreChip } from "@/components/ScoreChip";
import { extractCompany } from "@/lib/company";
import type { ExaResult, RerankItem } from "@/types/job";

interface DetailPaneProps {
  exaResults: ExaResult[];
  reranked: RerankItem[];
  selectedIdx: number | null;
}

export function DetailPane({ exaResults, reranked, selectedIdx }: DetailPaneProps) {
  if (selectedIdx === null) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-ink-soft gap-4 py-16">
        <svg
          width="80"
          height="80"
          viewBox="0 0 80 80"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="opacity-50"
        >
          <rect x="16" y="10" width="48" height="60" rx="6" stroke="currentColor" fill="var(--surface)" />
          <line x1="24" y1="24" x2="56" y2="24" stroke="currentColor" strokeWidth="2" />
          <line x1="24" y1="32" x2="48" y2="32" />
          <line x1="24" y1="40" x2="52" y2="40" />
          <line x1="24" y1="48" x2="44" y2="48" />
          <path d="M50 14V6l6 6h-6z" fill="var(--surface)" stroke="currentColor" />
        </svg>
        <p className="text-ink-soft">Pick a role to read it here.</p>
      </div>
    );
  }

  const results =
    reranked.length > 0
      ? reranked.map((r) => ({ ...exaResults[r.idx], score: r.score, fit: r.fit }))
      : exaResults.map((r) => ({ ...r, score: undefined, fit: undefined }));

  const job = results[selectedIdx];
  if (!job) return null;

  const domain = (() => {
    try { return new URL(job.url).hostname.replace("www.", ""); } catch { return null; }
  })();

  return (
    <div className="h-full overflow-y-auto">
      <div className="sticky top-0 bg-surface/95 backdrop-blur-sm z-10 pb-3 border-b border-border mb-4">
        <h2
          className="text-display font-medium leading-tight"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {job.title}
        </h2>
        <p className="text-small text-ink-soft mt-1">
          {[extractCompany(job.url) || job.author, job.publishedDate ? `Posted ${relativeDate(job.publishedDate)}` : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <div className="flex items-center gap-3 mt-3 flex-wrap">
          <a
            href={job.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-accent text-white text-small font-medium hover:opacity-90 transition-opacity"
          >
            Apply on {domain || "site"} <ExternalLink size={14} strokeWidth={2} aria-hidden />
          </a>
          {job.score !== undefined && (
            <span className="flex items-center gap-2 text-small text-ink-soft">
              <ScoreChip score={job.score} />
              Matches your ask
            </span>
          )}
        </div>
      </div>

      <div className="prose prose-sm prose-stone dark:prose-invert max-w-none" style={{ maxWidth: "70ch" }}>
        {renderDescription(job.text)}
      </div>

      {domain && (
        <p className="text-micro text-ink-soft mt-8 pt-4 border-t border-border">
          Source: {domain}
        </p>
      )}
    </div>
  );
}

function relativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "1 day ago";
  if (diffDays < 30) return `${diffDays} days ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

function renderDescription(text?: string) {
  if (!text) return null;

  const lines = text.replace(/^#+/gm, "##").split("\n");
  const elements: React.ReactNode[] = [];
  let bulletBuffer: string[] = [];
  let key = 0;

  function flushBullets() {
    if (bulletBuffer.length === 0) return;
    elements.push(
      <ul key={key++} className="list-disc ml-5 my-2 space-y-1">
        {bulletBuffer.map((b) => (
          <li key={key++} className="text-body leading-relaxed text-ink-soft">
            {b.replace(/^[*-] /, "")}
          </li>
        ))}
      </ul>,
    );
    bulletBuffer = [];
  }

  for (const line of lines) {
    if (line.startsWith("## ")) {
      flushBullets();
      elements.push(
        <h3 key={key++} className="text-h2 font-medium mt-6 mb-2 text-ink" style={{ fontFamily: "var(--font-sans)" }}>
          {line.replace(/^## /, "")}
        </h3>,
      );
    } else if (/^[*-] /.test(line)) {
      bulletBuffer.push(line);
    } else if (line.trim() === "") {
      flushBullets();
      elements.push(<div key={key++} className="h-2" />);
    } else {
      flushBullets();
      elements.push(
        <p key={key++} className="text-body leading-relaxed text-ink-soft">
          {line}
        </p>,
      );
    }
  }
  flushBullets();

  return elements;
}
