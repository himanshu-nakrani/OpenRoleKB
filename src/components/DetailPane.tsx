"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { ScoreChip } from "@/components/ScoreChip";
import { FreshnessPill } from "@/components/FreshnessPill";
import { StillListedBadge } from "@/components/StillListedBadge";
import dynamic from "next/dynamic";
const FeedbackModal = dynamic(
  () => import("@/components/FeedbackModal").then((m) => m.FeedbackModal),
  { ssr: false },
);
import { extractCompany } from "@/lib/company";
import type { ExaResult, RerankItem, Filters } from "@/types/job";

interface DetailPaneProps {
  exaResults: ExaResult[];
  reranked: RerankItem[];
  selectedIdx: number | null;
  filters?: Filters | null;
}

export function DetailPane({ exaResults, reranked, selectedIdx, filters }: DetailPaneProps) {
  const [feedbackOpen, setFeedbackOpen] = useState(false);

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

  const currentFilters = filters ?? null; // prefer prop-drilled (avoids brittle DOM querySelector hack)

  return (
    <div>
      <div className="max-w-[65ch] mx-auto">
      <div className="sticky top-0 bg-surface/95 backdrop-blur-sm z-10 pb-3 border-b border-border mb-6">
        <h2 className="text-h2 font-medium leading-snug font-display-opsz-h2">
          {job.title}
        </h2>
        <div className="flex flex-wrap items-center gap-2 text-small text-muted mt-2">
          {(extractCompany(job.url) || job.author) && (
            <span>{extractCompany(job.url) || job.author}</span>
          )}
          {job.publishedDate && <FreshnessPill publishedDate={job.publishedDate} />}
          {job.lastSeenAt && <StillListedBadge lastSeenAt={job.lastSeenAt} publishedDate={job.publishedDate} />}
          {(job.salaryMinUsd || job.salaryMaxUsd) && (
            <span className="text-accent">
              {job.salaryMinUsd ? `$${Math.round(job.salaryMinUsd / 1000)}k` : ""}
              {job.salaryMinUsd && job.salaryMaxUsd ? "–" : ""}
              {job.salaryMaxUsd ? `$${Math.round(job.salaryMaxUsd / 1000)}k` : ""}
              {job.salaryRaw ? " (est.)" : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4 mt-4 flex-wrap">
          <a
            href={`/api/click?jobId=${encodeURIComponent(job.id)}`}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-accent-dark text-accent-text text-small font-medium hover:brightness-110 active:brightness-90 active:scale-[0.98] transition-all duration-120"
          >
            Apply on {domain || "site"} <ExternalLink size={14} strokeWidth={2} aria-hidden />
          </a>
          <button
            onClick={async () => {
              const company = extractCompany(job.url) || job.author;
              if (!company) return;
              try {
                await fetch("/api/hidden-companies", {
                  method: "POST",
                  headers: { "Content-Type": "application/json", "x-anon-id": localStorage.getItem("openrolekb_anon_id") || "" },
                  body: JSON.stringify({ company }),
                });
                alert(`Hidden ${company}. Future results will exclude it.`);
              } catch {}
            }}
            className="text-small text-muted hover:text-ink px-3 py-2 border border-border rounded-full"
          >
            Hide company
          </button>
          {job.score !== undefined && (
            <span className="flex items-center gap-2 text-small text-muted">
              <ScoreChip score={job.score} />
              Matches your ask
            </span>
          )}
        </div>
      </div>

      <article className="job-description max-w-none">
        {renderDescription(job.text)}
      </article>

      {domain && (
        <div className="mt-8 pt-4 border-t border-border flex items-center justify-between">
          <p className="text-micro text-muted">
            Source: {domain}
          </p>
          <button
            onClick={() => setFeedbackOpen(true)}
            className="text-micro text-muted hover:text-accent transition-colors duration-120"
          >
            Tell us this match was off →
          </button>
        </div>
      )}

      <FeedbackModal
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        jobId={job.id}
        rawQuery={job.title}
        filters={currentFilters}
        rerankScore={job.score ?? null}
        fit={job.fit ?? null}
      />
      </div>
    </div>
  );
}

const BULLET_RX = /^\s*(?:[*\-•◦▪●·‣⁃]|\d+[.)])\s+/;
const INLINE_BULLET_RX = /\s+(?:[•◦▪●‣⁃])\s+/g;
const HEADING_RX = /^#{1,6}\s+(.+)$/;

// Common ATS section label phrases. Order matters: longer patterns first so
// "What You'll Bring" is captured before "What You" alone.
const SECTION_LABELS = [
  "About (?:the|us|the role|the company|the team)",
  "The (?:Role|Team|Opportunity|Position|Job|Company)",
  "Job (?:Description|Summary|Requirements|Duties|Responsibilities)",
  "Position (?:Summary|Overview|Description|Requirements)",
  "Role (?:Summary|Overview|Description)",
  "What [Yy]ou[\x27\u2018\u2019]?ll [Dd]o",
  "What [Yy]ou[\x27\u2018\u2019]?ll [Bb]ring",
  "What [Yy]ou[\x27\u2018\u2019]?ll [Nn]eed",
  "What [Yy]ou[\x27\u2018\u2019]?ll [Ww]ork [Oo]n",
  "What [Yy]ou[\x27\u2018\u2019]?ll [Ll]earn",
  "What [Ww]e[\x27\u2018\u2019]?re [Ll]ooking [Ff]or",
  "What [Ww]e [Oo]ffer",
  "Why [Yy]ou[\x27\u2018\u2019]?ll [Ll]ove [A-Z][\w&'.-]{1,40}",
  "Why (?:Join|Work [Ww]ith|Apply To) [A-Z][\w&'.-]{1,40}",
  "Working [Aa]t [A-Z][\w&'.-]{1,40}",
  "Responsibilities",
  "Key Responsibilities",
  "Day[- ]to[- ]Day",
  "Your Day",
  "Requirements",
  "Job Requirements",
  "Key Requirements",
  "Qualifications",
  "Basic Qualifications",
  "Preferred Qualifications",
  "Minimum Qualifications",
  "Required Qualifications",
  "Must[- ]?[Hh]aves?",
  "Nice[- ]?to[- ]?[Hh]aves?",
  "Bonus Points",
  "Skills(?: Required)?",
  "Required Skills",
  "Technical Requirements",
  "Tech(?:nical)? Stack",
  "Our Stack",
  "Experience",
  "Experience Required",
  "Education",
  "Education Requirements",
  "Benefits",
  "Benefits & Perks",
  "Perks",
  "Perks & Benefits",
  "Compensation",
  "Salary(?: Range)?",
  "Pay Range",
  "Equal Opportunity",
  "EEO Statement",
  "Diversity (?:&|and) Inclusion",
  "Our (?:Team|Mission|Values|Culture|Company|Story)",
  "About [A-Z][\w &'.-]{1,40}",
];

const SECTION_LABEL_RX = new RegExp(
  // All-lookbehind: we match the label itself only, with zero-width
  // assertions on each side. preprocess() injects newlines around it.
  // - Must be preceded by: start, newline, period/?/!/) + whitespace, or whitespace.
  // - Must be followed by: optional colon, then whitespace or end.
  // This catches both wall-of-text descriptions and properly-paragraphed ones.
  String.raw`(?<=^|\n|[.!?)]\s|\s)(` +
    SECTION_LABELS.join("|") +
    String.raw`):?(?=\s|$)`,
  "g",
);
const INLINE_RX = /(\*\*(?:.+?)\*\*)|(https?:\/\/[^\s)]+)/g;

function renderInline(text: string, baseKey: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let lastIdx = 0;
  let i = 0;
  const rx = new RegExp(INLINE_RX.source, "g");
  let m: RegExpExecArray | null;

  while ((m = rx.exec(text)) !== null) {
    if (m.index > lastIdx) {
      out.push(<span key={`${baseKey}-t${i++}`}>{text.slice(lastIdx, m.index)}</span>);
    }
    if (m[1]) {
      out.push(
        <strong key={`${baseKey}-b${i++}`} className="font-semibold text-ink">
          {m[1].slice(2, -2)}
        </strong>,
      );
    } else if (m[2]) {
      out.push(
        <a
          key={`${baseKey}-u${i++}`}
          href={m[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:underline break-all"
        >
          {m[2]}
        </a>,
      );
    }
    lastIdx = m.index + m[0].length;
  }

  if (lastIdx < text.length) {
    out.push(<span key={`${baseKey}-t${i++}`}>{text.slice(lastIdx)}</span>);
  }

  return out.length > 0 ? out : [<span key={`${baseKey}-t0`}>{text}</span>];
}

type Block =
  | { kind: "h"; level: 2 | 3; text: string }
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] };

function preprocess(raw: string): string {
  let s = raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\u00A0\u2007\u202F]/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");

  // Insert breaks before recognized section labels so wall-of-text descriptions
  // get usable headings even when Exa stripped all whitespace.
  s = s.replace(SECTION_LABEL_RX, (_match, label) => `\n\n${label}\n`);

  // Split inline bullet runs onto their own lines (e.g.
  // "We need: • React • TypeScript • Tailwind" → newline-separated bullets).
  // Only fires when 2+ bullets are present on the same line.
  s = s.replace(/[^\n]*?(?:\s[•◦▪●‣⁃]\s[^\n]+){2,}/g, (chunk) =>
    chunk.replace(INLINE_BULLET_RX, "\n• "),
  );

  // Collapse any extra blank lines section-label injection may have introduced.
  s = s.replace(/\n{3,}/g, "\n\n");

  return s.trim();
}

function parseBlocks(raw: string): Block[] {
  const cleaned = preprocess(raw);
  const paragraphs = cleaned.split(/\n\s*\n+/);
  const blocks: Block[] = [];

  let listBuffer: string[] = [];
  let listOrdered = false;
  function flushList() {
    if (listBuffer.length === 0) return;
    blocks.push({ kind: listOrdered ? "ol" : "ul", items: listBuffer.slice() });
    listBuffer = [];
    listOrdered = false;
  }

  for (const para of paragraphs) {
    const lines = para.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;

    const allBullets = lines.every((l) => BULLET_RX.test(l));
    if (allBullets) {
      const ordered = /^\d+[.)]\s/.test(lines[0]);
      if (listBuffer.length > 0 && listOrdered !== ordered) flushList();
      listOrdered = ordered;
      listBuffer.push(...lines.map((l) => l.replace(BULLET_RX, "").trim()));
      continue;
    }
    flushList();

    if (lines.length === 1) {
      const h = lines[0].match(HEADING_RX);
      if (h) {
        blocks.push({ kind: "h", level: 2, text: h[1].replace(/:$/, "") });
        continue;
      }
      const looksLikeHeading =
        lines[0].length < 70 &&
        !/[.!?]$/.test(lines[0]) &&
        /^[A-Z]/.test(lines[0]) &&
        lines[0].split(/\s+/).length <= 9;
      if (looksLikeHeading) {
        blocks.push({ kind: "h", level: 3, text: lines[0].replace(/:$/, "") });
        continue;
      }
    }

    blocks.push({ kind: "p", text: lines.join(" ") });
  }
  flushList();

  return blocks;
}

function renderDescription(text?: string) {
  if (!text || !text.trim()) {
    return (
      <p className="text-body text-muted italic">
        No description available for this role.
      </p>
    );
  }

  const blocks = parseBlocks(text);

  return blocks.map((block, i) => {
    const key = `b${i}`;
    switch (block.kind) {
      case "h":
        return block.level === 2 ? (
          <h3 key={key} className="text-h2 font-semibold text-ink mt-7 mb-3 first:mt-0 tracking-tight">
            {block.text}
          </h3>
        ) : (
          <h4 key={key} className="text-body font-semibold text-ink mt-6 mb-2 first:mt-0 uppercase tracking-wider text-[0.78rem]">
            {block.text}
          </h4>
        );
      case "p":
        return (
          <p key={key} className="text-body leading-[1.7] text-ink-soft my-3 first:mt-0">
            {renderInline(block.text, key)}
          </p>
        );
      case "ul":
        return (
          <ul key={key} className="list-disc pl-5 my-3 space-y-1.5 marker:text-ink-soft/40">
            {block.items.map((item, j) => (
              <li key={`${key}-${j}`} className="text-body leading-[1.7] text-ink-soft pl-1">
                {renderInline(item, `${key}-${j}`)}
              </li>
            ))}
          </ul>
        );
      case "ol":
        return (
          <ol key={key} className="list-decimal pl-5 my-3 space-y-1.5 marker:text-ink-soft/40">
            {block.items.map((item, j) => (
              <li key={`${key}-${j}`} className="text-body leading-[1.7] text-ink-soft pl-1">
                {renderInline(item, `${key}-${j}`)}
              </li>
            ))}
          </ol>
        );
    }
  });
}

