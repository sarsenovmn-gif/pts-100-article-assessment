import { CONDUCT_META, CRITERION_META } from "@/lib/rubric";
import type {
  Assessment,
  ArticleParts,
  AuditData,
  Finding,
  PtsSubScore,
  Scores,
  Severity,
} from "@/lib/types";

function scoreColor(score: number | null): string {
  if (score === null) return "text-zinc-400";
  if (score >= 75) return "text-emerald-400";
  if (score >= 60) return "text-lime-400";
  if (score >= 40) return "text-amber-400";
  return "text-red-400";
}

function severityColor(sev: Severity): string {
  switch (sev) {
    case "PASS":
      return "text-emerald-400";
    case "MINOR":
      return "text-lime-400";
    case "MODERATE":
      return "text-amber-400";
    case "MAJOR":
    case "SEVERE":
      return "text-red-400";
    case "UNRESOLVED":
      return "text-indigo-300";
    default:
      return "text-zinc-500";
  }
}

function severityBadge(sev: Severity): string {
  switch (sev) {
    case "SEVERE":
    case "MAJOR":
      return "bg-red-500/20 text-red-300";
    case "MODERATE":
      return "bg-amber-500/20 text-amber-300";
    case "MINOR":
      return "bg-lime-500/20 text-lime-300";
    case "UNRESOLVED":
      return "bg-indigo-500/20 text-indigo-300";
    default:
      return "bg-zinc-700/50 text-zinc-300";
  }
}

function confidenceColor(c: string): string {
  if (c === "HIGH") return "text-emerald-400";
  if (c === "MEDIUM") return "text-amber-400";
  return "text-red-400";
}

function Chip({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-300">
      <span className="text-zinc-500">{label}</span>
      <span className="font-medium">{value}</span>
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
        {title}
      </h3>
      {children}
    </div>
  );
}

function FindingCard({ f }: { f: Finding }) {
  const meta = CRITERION_META[f.criterion];
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 font-mono text-xs font-semibold ${severityBadge(f.severity)}`}>
          {f.criterion}
        </span>
        <span className="text-sm font-medium text-zinc-200">{meta?.name ?? f.criterion}</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${severityBadge(f.severity)}`}>
          {f.severity}
        </span>
        <span className="ml-auto font-mono text-sm font-semibold text-red-300">
          −{Math.round(f.points_lost * 100) / 100}
          <span className="text-zinc-600">/{f.points_possible}</span>
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-2 text-[11px] text-zinc-400">
        {f.stance && f.stance !== "N/A" && <span>stance: {f.stance}</span>}
        {f.three_d && <span className="text-fuchsia-300">3D: {f.three_d}</span>}
        {f.rung && <span className="text-orange-300">{f.rung}</span>}
        {f.section && <span>section: {f.section}</span>}
        {f.ihra_examples.length > 0 && <span>IHRA {f.ihra_examples.join(", ")}</span>}
        {f.confidence !== null && <span>confidence {f.confidence.toFixed(2)}</span>}
        {f.quote_match === "approximate" && (
          <span className="rounded bg-amber-500/20 px-1.5 text-amber-300">approximate quote</span>
        )}
        {f.quote_match === "unverified" && (
          <span className="rounded bg-indigo-500/20 px-1.5 text-indigo-300">quote unverified</span>
        )}
        {f.irony_possible && (
          <span className="rounded bg-fuchsia-500/20 px-1.5 text-fuchsia-300">irony possible</span>
        )}
      </div>
      {f.quote && (
        <blockquote className="mt-2 border-l-2 border-red-400/40 pl-3 text-xs italic text-zinc-300">
          “{f.quote}”
        </blockquote>
      )}
      {f.rationale && <p className="mt-2 text-xs leading-5 text-zinc-400">{f.rationale}</p>}
    </div>
  );
}

function CoverageBar({ pct }: { pct: number }) {
  const color = pct >= 90 ? "bg-emerald-400" : pct >= 70 ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function SubScoreCard({ code, label, sub }: { code: string; label: string; sub: PtsSubScore }) {
  const display = sub.displayed_score === null ? "—" : String(sub.displayed_score);
  return (
    <div className="flex-1 rounded-2xl border border-white/10 bg-white/[0.04] p-5">
      <div className="flex items-start gap-4">
        <div className="flex shrink-0 flex-col items-center justify-center">
          <span className={`text-5xl font-bold tabular-nums ${scoreColor(sub.displayed_score)}`}>
            {display}
          </span>
          <span className="text-[10px] uppercase tracking-widest text-zinc-500">{code}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs text-zinc-500">{label}</div>
          <div className={`text-base font-semibold ${scoreColor(sub.displayed_score)}`}>{sub.tier}</div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-500">
            <span>coverage {sub.coverage_pct}%</span>
            <span>
              confidence <span className={confidenceColor(sub.confidence)}>{sub.confidence}</span>
            </span>
            {sub.unresolved_count > 0 && (
              <span className="text-indigo-300">{sub.unresolved_count} unresolved</span>
            )}
          </div>
          <CoverageBar pct={sub.coverage_pct} />
          <div className="mt-1 text-[10px] text-zinc-600">{sub.coverage}</div>
        </div>
      </div>

      {sub.inconclusive && sub.inconclusive_reason && (
        <div className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] leading-4 text-amber-200">
          <span className="font-semibold">Not a definitive 100.</span> {sub.inconclusive_reason}
        </div>
      )}

      {sub.cap_applied && (
        <div className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          <span className="font-semibold">Cap applied ({sub.score}).</span> {sub.cap_reason}
          {sub.raw_before_cap !== null && (
            <span className="text-red-300/70"> (raw {sub.raw_before_cap})</span>
          )}
        </div>
      )}

      {sub.findings.length > 0 && (
        <div className="mt-4 space-y-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-red-300/80">
            Findings ({sub.findings.length})
          </h4>
          {sub.findings.map((f, i) => (
            <FindingCard key={i} f={f} />
          ))}
        </div>
      )}

      {sub.conduct_breaches && sub.conduct_breaches.length > 0 && (
        <div className="mt-4 space-y-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-orange-300/80">
            Conduct breaches ({sub.conduct_breaches.length})
          </h4>
          {sub.conduct_breaches.map((b, i) => (
            <div key={i} className="rounded-xl border border-orange-500/20 bg-orange-500/[0.06] p-3">
              <div className="flex items-center gap-2">
                <span className="rounded bg-orange-500/20 px-1.5 py-0.5 font-mono text-xs font-semibold text-orange-300">
                  Clause {b.clause}
                </span>
                <span className="text-sm font-medium text-zinc-200">
                  {CONDUCT_META[b.clause] ?? "Conduct"}
                </span>
                <span className={`ml-auto rounded px-1.5 py-0.5 text-[10px] font-semibold ${severityBadge(b.severity)}`}>
                  {b.severity}
                </span>
              </div>
              {b.person && <div className="mt-1 text-[11px] text-zinc-400">person: {b.person}</div>}
              {b.quote && (
                <blockquote className="mt-2 border-l-2 border-orange-400/40 pl-3 text-xs italic text-zinc-300">
                  “{b.quote}”
                </blockquote>
              )}
              {b.rationale && <p className="mt-2 text-xs leading-5 text-zinc-400">{b.rationale}</p>}
            </div>
          ))}
        </div>
      )}

      {sub.unresolved.length > 0 && (
        <div className="mt-4">
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-indigo-300/80">
            Unresolved ({sub.unresolved.length})
          </h4>
          <ul className="space-y-2">
            {sub.unresolved.map((u, i) => (
              <li key={i} className="text-sm text-zinc-400">
                <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 font-mono text-xs font-semibold text-indigo-300">
                  {u.criterion}
                </span>{" "}
                {u.reason}
                {u.quote && <span className="text-zinc-600"> — “{u.quote}”</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {sub.human_review.length > 0 && (
        <div className="mt-4">
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-indigo-300/80">
            Human review queue ({sub.human_review.length})
          </h4>
          <ul className="space-y-2">
            {sub.human_review.map((h, i) => (
              <li key={i} className="flex gap-2 text-sm text-zinc-300">
                <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 font-mono text-xs font-semibold text-indigo-300">
                  {h.criterion}
                </span>
                <span className="text-zinc-400">{h.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {sub.rejected_findings.length > 0 && (
        <div className="mt-4">
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
            Rejected by rules ({sub.rejected_findings.length})
          </h4>
          <ul className="space-y-2">
            {sub.rejected_findings.map((r, i) => (
              <li key={i} className="text-sm text-zinc-400">
                <span className="rounded bg-zinc-700/50 px-1.5 py-0.5 font-mono text-xs font-semibold text-zinc-300">
                  {r.criterion}
                </span>{" "}
                {r.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {sub.not_applicable.length > 0 && (
        <div className="mt-4">
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
            Not applicable
          </h4>
          <div className="flex flex-wrap gap-2">
            {sub.not_applicable.map((cid) => (
              <span
                key={cid}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-400"
              >
                <span className="font-mono font-semibold text-zinc-300">{cid}</span>
                {CRITERION_META[cid]?.name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function verdictBadge(v: string): string {
  if (v === "CONFIRMED") return "bg-red-500/20 text-red-300";
  if (v === "DOWNGRADED") return "bg-amber-500/20 text-amber-300";
  return "bg-zinc-700/50 text-zinc-400";
}

function AuditPanel({ audit }: { audit: AuditData }) {
  const runs = audit.prosecutor_runs ?? [];
  const rejected = (audit.verdicts ?? []).filter((v) => v.verdict === "REJECTED");
  return (
    <details className="rounded-2xl border border-white/10 bg-black/20 p-4 sm:p-5">
      <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-wider text-zinc-400">
        Audit — why did it pass? ({audit.merged_allegations?.length ?? 0} allegations,{" "}
        {(audit.verdicts ?? []).filter((v) => v.verdict !== "REJECTED").length} confirmed,{" "}
        {rejected.length} rejected)
      </summary>

      <div className="mt-4 space-y-4">
        {audit.consistency !== null && audit.consistency !== undefined && (
          <p className="text-xs text-zinc-400">
            <span className="font-semibold text-zinc-300">Consistency {audit.consistency.toFixed(2)}</span> —{" "}
            {audit.consistency_note}
          </p>
        )}

        {runs.length > 0 && (
          <div>
            <h5 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Prosecutor allegations per run ({runs.length} run{runs.length === 1 ? "" : "s"})
            </h5>
            <div className="space-y-2">
              {runs.map((r, ri) => (
                <div key={ri} className="rounded-lg border border-white/5 bg-black/30 p-2.5">
                  <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-600">Run {ri + 1}</div>
                  {r.allegations.length === 0 ? (
                    <p className="text-xs text-zinc-500">No allegations.</p>
                  ) : (
                    <ul className="space-y-1">
                      {r.allegations.map((a, ai) => (
                        <li key={ai} className="text-xs text-zinc-400">
                          <span className="font-mono font-semibold text-zinc-300">{a.criterion}</span>{" "}
                          <span className="text-zinc-500">[{a.stance}]</span> {a.argument}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {(audit.verdicts ?? []).length > 0 && (
          <div>
            <h5 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Judge verdicts (rule cited)
            </h5>
            <ul className="space-y-1.5">
              {(audit.verdicts ?? []).map((v, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${verdictBadge(v.verdict)}`}>
                    {v.verdict}
                  </span>
                  <span className="font-mono text-zinc-300">{v.final_criterion}</span>
                  <span className="min-w-0 flex-1 text-zinc-500">{v.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {(audit.dismissed_lexicon_hits ?? []).length > 0 && (
          <div>
            <h5 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Lexicon hits dismissed
            </h5>
            <ul className="space-y-1">
              {audit.dismissed_lexicon_hits.map((d, i) => (
                <li key={i} className="text-xs text-zinc-400">
                  <span className="font-mono text-zinc-300">{d.id}</span> — {d.reason}
                </li>
              ))}
            </ul>
          </div>
        )}

        {(audit.normalisation_events ?? []).length > 0 && (
          <div>
            <h5 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Matched after normalisation
            </h5>
            <ul className="space-y-1">
              {audit.normalisation_events.map((n, i) => (
                <li key={i} className="text-xs text-zinc-400">
                  <span className="font-mono text-zinc-300">“{n.original}”</span> {n.normalised}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}

export function ResultsPanel({
  score,
  assessment,
  parts,
}: {
  score: Scores;
  assessment: Assessment | null;
  parts: ArticleParts;
}) {
  const isSatire = score.pts_a.displayed_score === null && score.pts_j.displayed_score === null;
  const legal = score.legal_flag;

  return (
    <div className="mt-8 space-y-4">
      {score.mocked && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <span className="font-semibold">Mock result (development only).</span> PTS_ALLOW_MOCK is
          enabled; this is a placeholder assessment, never a production result.
        </div>
      )}

      {score.injection?.suspected && (
        <div className="rounded-xl border border-fuchsia-500/40 bg-fuchsia-500/10 px-4 py-3 text-sm text-fuchsia-200">
          <span className="font-semibold">Prompt-injection attempt detected.</span> The text contains
          instructions aimed at the assessor; they were ignored, the result is routed to human review,
          and the scores below are computed from the content only.
          <ul className="mt-2 space-y-1 text-xs text-fuchsia-200/80">
            {score.injection.passages.slice(0, 4).map((p, i) => (
              <li key={i}>
                <span className="text-fuchsia-300/70">[{p.label}]</span> “{p.text}”
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4">
        <div className="text-sm text-zinc-300">
          <span className="font-semibold">PTS-A {score.pts_a.displayed_score ?? "—"}</span>
          <span className="mx-2 text-zinc-600">·</span>
          <span className="font-semibold">PTS-J {score.pts_j.displayed_score ?? "—"}</span>
        </div>
        {!isSatire && (
          <div className="text-xs text-zinc-500">
            Weakest link:{" "}
            <span className={`font-semibold ${scoreColor(score.headline_score)}`}>
              {score.headline_score ?? "—"}
            </span>{" "}
            (independent, never blended)
          </div>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          <Chip label="Designation" value={score.designation} />
          <Chip label="Language" value={score.language} />
          <Chip label="Stance" value={score.overall_stance} />
          <Chip label="Candidate passages" value={String(score.candidate_passages?.length ?? 0)} />
          {score.consistency !== null && score.consistency !== undefined && (
            <Chip label="Consistency" value={score.consistency.toFixed(2)} />
          )}
          {score.provenance.architecture && (
            <Chip label="Architecture" value={score.provenance.architecture} />
          )}
        </div>
      </div>

      {!isSatire && (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-xs leading-5 text-zinc-500">
          <span className="font-semibold text-zinc-400">Scope:</span> PTS judges the{" "}
          <span className="text-zinc-300">text as written</span> — antisemitism (IHRA + Sharansky
          3D) and journalistic-standards/sourcing breaches. It is <span className="text-zinc-300">not</span> a
          fact-check against external reality and <span className="text-zinc-300">not</span> a bias meter.
          A 100 requires ≥90% coverage, no unresolved criteria and adequate confidence.
        </div>
      )}

      {score.note && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-zinc-400">
          {score.note}
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

      <div className="flex flex-col gap-4 lg:flex-row">
        <SubScoreCard code="PTS-A" label="Antisemitism (IHRA + 3D)" sub={score.pts_a} />
        <SubScoreCard code="PTS-J" label="Journalistic standards + sourcing" sub={score.pts_j} />
      </div>

      {score.org_resolutions && score.org_resolutions.some((r) => r.resolved) && (
        <Section title="Designated-source resolution (deterministic)">
          <ul className="space-y-2 text-xs text-zinc-400">
            {score.org_resolutions
              .filter((r) => r.resolved)
              .map((r, i) => (
                <li key={i}>
                  <span className="font-mono text-zinc-300">{r.query}</span> →{" "}
                  <span className="font-semibold text-zinc-200">{r.canonical_name}</span>
                  {r.designated ? (
                    <span className="ml-1 text-amber-300">
                      designated · {r.authority} · {r.scope}
                      {r.wing ? ` (${r.wing} wing)` : ""} · {r.list_version}
                    </span>
                  ) : (
                    <span className="ml-1 text-zinc-500">not designated</span>
                  )}
                  {r.via_controlled_body && (
                    <span className="ml-1 text-zinc-500">
                      via controlled body: {r.via_controlled_body.name}
                    </span>
                  )}
                </li>
              ))}
          </ul>
        </Section>
      )}

      {score.summary && (
        <Section title="Summary">
          <p className="text-sm leading-6 text-zinc-300">{score.summary}</p>
        </Section>
      )}

      {score.candidate_passages && score.candidate_passages.length > 0 && (
        <Section title={`Candidate passages (${score.candidate_passages.length})`}>
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

      {assessment && assessment.criteria.length > 0 && (
        <Section title="All criteria">
          <div className="grid gap-1.5 sm:grid-cols-2">
            {assessment.criteria.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-2 rounded-lg border border-white/5 bg-black/20 px-2.5 py-1.5"
              >
                <span className="font-mono text-xs font-semibold text-zinc-300">{c.id}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-zinc-400">
                  {CRITERION_META[c.id]?.name ?? c.id}
                </span>
                <span className={`text-[10px] font-semibold ${severityColor(c.severity)}`}>
                  {c.severity}
                </span>
              </div>
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

      {score.audit && <AuditPanel audit={score.audit} />}

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
        {parts.warning && <p className="mt-2 text-amber-300/80">{parts.warning}</p>}
        <div className="mt-3 border-t border-white/5 pt-3 font-mono text-[11px] text-zinc-600">
          run {score.provenance.run_id} · {score.provenance.prompt_version}
          {score.provenance.rubric_version && ` · ${score.provenance.rubric_version}`}
          {score.provenance.lexicon_version && ` · lex:${score.provenance.lexicon_version}`}
          {score.provenance.input_sha256 && ` · sha256:${score.provenance.input_sha256}`}
          {score.provenance.architecture === "two-pass" ? (
            <>
              {` · prosecutor:${score.provenance.prosecutor_model} ×${score.provenance.prosecutor_runs}`}
              {`@${score.provenance.prosecutor_temperature}`}
              {` · judge:${score.provenance.judge_model} ×${score.provenance.judge_runs}`}
              {score.provenance.chunking_used ? " · chunked" : ""}
              {score.provenance.normalisation_event_count
                ? ` · norm:${score.provenance.normalisation_event_count}`
                : ""}
            </>
          ) : (
            ` · ${score.provenance.model}`
          )}
        </div>
      </div>
    </div>
  );
}
