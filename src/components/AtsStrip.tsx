"use client";

const ATS_HOSTS = [
  "greenhouse",
  "lever",
  "ashby",
  "workday",
  "workable",
  "smartrecruiters",
  "bamboohr",
  "recruitee",
  "personio",
  "teamtailor",
];

export function AtsStrip() {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-micro text-muted uppercase tracking-wider">
        Live across {ATS_HOSTS.length} ATS sources
      </p>
      <div className="flex flex-wrap gap-x-3 gap-y-1.5">
        {ATS_HOSTS.map((h) => (
          <span
            key={h}
            className="text-small font-mono text-ink-soft tracking-tight"
          >
            {h}
          </span>
        ))}
      </div>
    </div>
  );
}
