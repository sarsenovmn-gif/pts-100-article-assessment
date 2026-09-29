import type { Assessment, CriterionResult } from "@/lib/types";

function scoreColor(score: number): string {
  if (score >= 85) return "text-emerald-400";
  if (score >= 70) return "text-lime-400";
  if (score >= 55) return "text-amber-400";
  if (score >= 40) return "text-orange-400";
  return "text-red-400";
}

function barColor(score: number): string {
  if (score >= 85) return "bg-emerald-400";
  if (score >= 70) return "bg-lime-400";
  if (score >= 55) return "bg-amber-400";
  if (score >= 40) return "bg-orange-400";
  return "bg-red-400";
}

function ScoreRing({ score }: { score: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const offset = c - (score / 100) * c;
  return (
    <div className="relative h-24 w-24 shrink-0">
      <svg className="h-24 w-24 -rotate-90" viewBox="0 0 80 80">
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="7"
          className="text-white/10"
        />
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          className={scoreColor(score)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-2xl font-bold ${scoreColor(score)}`}>{score}</span>
        <span className="text-[10px] uppercase tracking-wide text-zinc-500">
          / 100
        </span>
      </div>
    </div>
  );
}

function CriterionCard({ c }: { c: CriterionResult }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-xs font-mono font-semibold text-indigo-300">
              {c.id}
            </span>
            <h3 className="text-sm font-semibold">{c.name}</h3>
          </div>
          <p className="mt-1 text-xs text-zinc-500">{c.description}</p>
        </div>
        <div className="text-right">
          {c.assessable && c.score !== null ? (
            <span className={`text-xl font-bold ${scoreColor(c.score)}`}>
              {c.score}
            </span>
          ) : (
            <span className="rounded bg-zinc-700/50 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
              Not assessable
            </span>
          )}
        </div>
      </div>

      {c.assessable && c.score !== null && (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className={`h-full rounded-full ${barColor(c.score)}`}
            style={{ width: `${c.score}%` }}
          />
        </div>
      )}

      <p className="mt-3 text-sm leading-6 text-zinc-300">{c.rationale}</p>

      {c.evidence.length > 0 && (
        <div className="mt-3 space-y-2">
          {c.evidence.map((q, i) => (
            <blockquote
              key={i}
              className="border-l-2 border-indigo-400/40 bg-black/20 px-3 py-1.5 text-xs italic leading-5 text-zinc-400"
            >
              “{q}”
            </blockquote>
          ))}
        </div>
      )}
    </div>
  );
}

export function ResultsPanel({ assessment }: { assessment: Assessment }) {
  const a = assessment;
  return (
    <div className="mt-8 space-y-4">
      {a.mocked && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
          Mock result — no ANTHROPIC_API_KEY configured. Scores are heuristic
          placeholders.
        </div>
      )}

      <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-5 sm:flex-row sm:items-center">
        <ScoreRing score={a.overallScore} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`text-lg font-semibold ${scoreColor(a.overallScore)}`}>
              {a.band}
            </span>
            <span className="text-xs text-zinc-500">overall PTS-100</span>
          </div>
          <p className="mt-1 text-sm leading-6 text-zinc-300">{a.summary}</p>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-xs text-zinc-400">
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          <span>
            <span className="text-zinc-500">Headline:</span> {a.article.title}
          </span>
          {a.article.byline && (
            <span>
              <span className="text-zinc-500">Byline:</span> {a.article.byline}
            </span>
          )}
          {a.article.published && (
            <span>
              <span className="text-zinc-500">Published:</span>{" "}
              {a.article.published}
            </span>
          )}
          <span>
            <span className="text-zinc-500">Source:</span> {a.article.source}
          </span>
          <span>
            <span className="text-zinc-500">Words:</span> {a.article.wordCount}
          </span>
          <span>
            <span className="text-zinc-500">Model:</span> {a.model}
          </span>
        </div>
      </div>

      <div className="space-y-3">
        {a.criteria.map((c) => (
          <CriterionCard key={c.id} c={c} />
        ))}
      </div>
    </div>
  );
}
