import { CONDUCT_META, CRITERION_META } from "@/lib/rubric";
import type { Assessment, ArticleParts, ScoreResult } from "@/lib/types";

const BLOCK_NAMES: Record<"A" | "B" | "C" | "D", string> = {
  A: "Antisemitism",
  B: "Accuracy",
  C: "Attribution",
  D: "Conduct",
};

function scoreColor(score: number | null): string {
  if (score === null) return "text-zinc-400";
  if (score >= 75) return "text-emerald-400";
  if (score >= 60) return "text-lime-400";
  if (score >= 40) return "text-amber-400";
  return "text-red-400";
}

function statusColor(status: string): string {
  if (status === "PASS") return "text-emerald-400";
  if (status === "FAIL") return "text-red-400";
  return "text-zinc-500";
}

function barColor(ratio: number): string {
  if (ratio >= 0.75) return "bg-emerald-400";
  if (ratio >= 0.6) return "bg-lime-400";
  if (ratio >= 0.4) return "bg-amber-400";
  return "bg-red-400";
}

function Chip({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  if (!value) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-300">
      <span className="text-zinc-500">{label}</span>
      <span className="font-medium">{value}</span>
    </span>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
        {title}
      </h3>
      {children}
    </div>
  );
}

function BlockBars({ score }: { score: ScoreResult }) {
  if (!score.points) return null;
  const { earned, possible } = score.points;
  const blocks: ("A" | "B" | "C" | "D")[] = ["A", "B", "C", "D"];
  return (
    <div className="space-y-3">
      {blocks.map((b) => {
        const e = earned[b];
        const p = possible[b];
        const ratio = p > 0 ? e / p : 0;
        return (
          <div key={b}>
            <div className="mb-1 flex items-baseline justify-between text-xs">
              <span className="text-zinc-300">
                <span className="font-mono font-semibold text-zinc-100">{b}</span>{" "}
                <span className="text-zinc-500">{BLOCK_NAMES[b]}</span>
              </span>
              <span className="font-mono text-zinc-400">
                {e}/{p}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className={`h-full rounded-full ${p > 0 ? barColor(ratio) : "bg-zinc-700"}`}
                style={{ width: `${p > 0 ? ratio * 100 : 0}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ResultsPanel({
  score,
  assessment,
  parts,
}: {
  score: ScoreResult;
  assessment: Assessment;
  parts: ArticleParts;
}) {
  const isSatire = score.final_score === null;
  const displayScore = isSatire ? "—" : String(score.final_score);
  const legal = score.legal_flag;

  return (
    <div className="mt-8 space-y-4">
      {score.mocked && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <span className="font-semibold">Mock result.</span> No model key
          (<code className="rounded bg-black/30 px-1">OPENROUTER_API_KEY</code> or{" "}
          <code className="rounded bg-black/30 px-1">ANTHROPIC_API_KEY</code>) is
          configured, so this is a placeholder all-PASS assessment. Add a key for
          a real PTS-100 evaluation.
        </div>
      )}

      {/* Headline score */}
      <div className="flex flex-col gap-5 rounded-2xl border border-white/10 bg-white/[0.04] p-5 sm:flex-row sm:items-center">
        <div className="flex shrink-0 flex-col items-center justify-center">
          <span
            className={`text-5xl font-bold tabular-nums ${scoreColor(score.final_score)}`}
          >
            {displayScore}
          </span>
          <span className="text-[10px] uppercase tracking-widest text-zinc-500">
            PTS-100
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className={`text-lg font-semibold ${scoreColor(score.final_score)}`}>
            {score.tier}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Chip label="Designation" value={score.designation} />
            <Chip label="Language" value={score.language} />
            <Chip label="Stance" value={score.overall_stance} />
            {score.points && <Chip label="Coverage" value={score.points.coverage} />}
            <Chip
              label="Candidate passages"
              value={String(score.candidate_passages?.length ?? 0)}
            />
          </div>
          {score.note && (
            <p className="mt-3 text-sm text-zinc-400">{score.note}</p>
          )}
        </div>
      </div>

      {score.cap_applied && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <span className="font-semibold">Critical cap applied (39).</span>{" "}
          {score.cap_reason}
        </div>
      )}

      {legal?.possible_illegal && (
        <div className="rounded-xl border border-fuchsia-500/40 bg-fuchsia-500/10 px-4 py-3 text-sm text-fuchsia-200">
          <span className="font-semibold">Legal flag: {legal.category}.</span>{" "}
          {legal.rationale || "Routing flag only — never a legal finding."}
          {legal.evidence_quote && (
            <blockquote className="mt-2 border-l-2 border-fuchsia-400/40 pl-3 text-xs italic text-fuchsia-200/80">
              “{legal.evidence_quote}”
            </blockquote>
          )}
        </div>
      )}

      {!isSatire && score.points && (
        <Section title="Block scores">
          <BlockBars score={score} />
          {score.raw_score_before_cap !== null &&
            score.raw_score_before_cap !== undefined &&
            score.cap_applied && (
              <p className="mt-3 text-xs text-zinc-500">
                Raw score before cap: {score.raw_score_before_cap}
              </p>
            )}
        </Section>
      )}

      {score.summary && (
        <Section title="Summary">
          <p className="text-sm leading-6 text-zinc-300">{score.summary}</p>
        </Section>
      )}

      {score.candidate_passages && score.candidate_passages.length > 0 && (
        <Section
          title={`Candidate passages found by the model (${score.candidate_passages.length})`}
        >
          <div className="space-y-2">
            {score.candidate_passages.map((p, i) => (
              <blockquote
                key={i}
                className="border-l-2 border-indigo-400/40 pl-3 text-xs italic leading-5 text-zinc-300"
              >
                “{p}”
              </blockquote>
            ))}
          </div>
        </Section>
      )}

      {assessment.criteria.length > 0 && (
        <Section title="All criteria">
          <div className="grid gap-1.5 sm:grid-cols-2">
            {assessment.criteria.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-2 rounded-lg border border-white/5 bg-black/20 px-2.5 py-1.5"
              >
                <span className="font-mono text-xs font-semibold text-zinc-300">
                  {c.id}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-zinc-400">
                  {CRITERION_META[c.id]?.name ?? c.id}
                </span>
                <span className={`text-[10px] font-semibold ${statusColor(c.status)}`}>
                  {c.status === "NOT_ASSESSABLE" ? "N/A" : c.status}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {score.findings && score.findings.length > 0 && (
        <Section title={`Findings — deductions (${score.findings.length})`}>
          <div className="space-y-3">
            {score.findings.map((f, i) => {
              const meta = CRITERION_META[f.criterion];
              return (
                <div
                  key={i}
                  className="rounded-xl border border-red-500/20 bg-red-500/[0.06] p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-red-500/20 px-1.5 py-0.5 font-mono text-xs font-semibold text-red-300">
                      {f.criterion}
                    </span>
                    <span className="text-sm font-medium text-zinc-200">
                      {meta?.name ?? f.criterion}
                    </span>
                    <span className="ml-auto font-mono text-sm font-semibold text-red-300">
                      −{f.points_lost}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-2 text-[11px] text-zinc-400">
                    <span>stance: {f.stance}</span>
                    {f.ihra_examples.length > 0 && (
                      <span>IHRA {f.ihra_examples.join(", ")}</span>
                    )}
                    {f.confidence !== null && (
                      <span>confidence {f.confidence.toFixed(2)}</span>
                    )}
                    {f.quote_approximate && (
                      <span className="rounded bg-amber-500/20 px-1.5 text-amber-300">
                        approximate quote
                      </span>
                    )}
                  </div>
                  {f.quote && (
                    <blockquote className="mt-2 border-l-2 border-red-400/40 pl-3 text-xs italic text-zinc-300">
                      “{f.quote}”
                    </blockquote>
                  )}
                  {f.rationale && (
                    <p className="mt-2 text-xs leading-5 text-zinc-400">
                      {f.rationale}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {score.conduct_breaches && score.conduct_breaches.length > 0 && (
        <Section title={`Conduct breaches (${score.conduct_breaches.length})`}>
          <div className="space-y-3">
            {score.conduct_breaches.map((b, i) => (
              <div
                key={i}
                className="rounded-xl border border-orange-500/20 bg-orange-500/[0.06] p-3"
              >
                <div className="flex items-center gap-2">
                  <span className="rounded bg-orange-500/20 px-1.5 py-0.5 font-mono text-xs font-semibold text-orange-300">
                    Clause {b.clause}
                  </span>
                  <span className="text-sm font-medium text-zinc-200">
                    {CONDUCT_META[b.clause] ?? "Conduct"}
                  </span>
                  <span className="ml-auto font-mono text-sm font-semibold text-orange-300">
                    −5
                  </span>
                </div>
                {b.quote && (
                  <blockquote className="mt-2 border-l-2 border-orange-400/40 pl-3 text-xs italic text-zinc-300">
                    “{b.quote}”
                  </blockquote>
                )}
                {b.rationale && (
                  <p className="mt-2 text-xs leading-5 text-zinc-400">
                    {b.rationale}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {score.human_review && score.human_review.length > 0 && (
        <Section title={`Human review queue (${score.human_review.length})`}>
          <ul className="space-y-2">
            {score.human_review.map((h, i) => (
              <li key={i} className="flex gap-2 text-sm text-zinc-300">
                <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 font-mono text-xs font-semibold text-indigo-300">
                  {h.criterion}
                </span>
                <span className="text-zinc-400">{h.reason}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {score.rejected_findings && score.rejected_findings.length > 0 && (
        <Section title={`Rejected by rules (${score.rejected_findings.length})`}>
          <ul className="space-y-2">
            {score.rejected_findings.map((r, i) => (
              <li key={i} className="text-sm text-zinc-400">
                <span className="rounded bg-zinc-700/50 px-1.5 py-0.5 font-mono text-xs font-semibold text-zinc-300">
                  {r.criterion}
                </span>{" "}
                {r.reason}
                {r.quote && (
                  <span className="text-zinc-600"> — “{r.quote}”</span>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {score.not_assessable && score.not_assessable.length > 0 && (
        <Section title="Not assessable from this text">
          <div className="flex flex-wrap gap-2">
            {score.not_assessable.map((cid) => (
              <span
                key={cid}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-400"
              >
                <span className="font-mono font-semibold text-zinc-300">{cid}</span>
                {CRITERION_META[cid]?.name}
              </span>
            ))}
          </div>
        </Section>
      )}

      {score.warnings && score.warnings.length > 0 && (
        <Section title="Warnings">
          <ul className="list-disc space-y-1 pl-5 text-xs text-amber-300/80">
            {score.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Section>
      )}

      {/* Source / provenance */}
      <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-xs text-zinc-500">
        <div className="flex flex-wrap gap-x-6 gap-y-1.5">
          {parts.headline && (
            <span>
              <span className="text-zinc-600">Headline:</span>{" "}
              <span className="text-zinc-400">{parts.headline}</span>
            </span>
          )}
          {parts.byline && (
            <span>
              <span className="text-zinc-600">Byline:</span>{" "}
              <span className="text-zinc-400">{parts.byline}</span>
            </span>
          )}
          {parts.published && (
            <span>
              <span className="text-zinc-600">Published:</span>{" "}
              <span className="text-zinc-400">{parts.published}</span>
            </span>
          )}
          {parts.source && (
            <span>
              <span className="text-zinc-600">Source:</span>{" "}
              <span className="text-zinc-400">{parts.source}</span>
            </span>
          )}
          <span>
            <span className="text-zinc-600">Body:</span>{" "}
            <span className="text-zinc-400">{parts.bodyChars} chars</span>
          </span>
          <span>
            <span className="text-zinc-600">Extractor:</span>{" "}
            <span className="text-zinc-400">{parts.extractor}</span>
          </span>
        </div>
        {parts.warning && (
          <p className="mt-2 text-amber-300/80">{parts.warning}</p>
        )}
        <div className="mt-3 border-t border-white/5 pt-3 font-mono text-[11px] text-zinc-600">
          run {score.provenance.run_id} · {score.provenance.model} ·{" "}
          {score.provenance.prompt_version}
          {score.provenance.input_sha256 &&
            ` · sha256:${score.provenance.input_sha256}`}
        </div>
      </div>
    </div>
  );
}
