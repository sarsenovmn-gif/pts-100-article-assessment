import { createHash, randomUUID } from "node:crypto";
import {
  AS_CONTESTED,
  AS_CRITICAL,
  AS_POINTS,
  AS_PROFILES,
  AS_STANCE_GATED,
  CAP_CRITICAL_A,
  CAP_FABRICATION_J,
  CAP_SOURCING_J,
  CONFIDENCE_HIGH,
  CONFIDENCE_MEDIUM,
  J_CORE_POINTS,
  J_PROFILES,
  JD_DEDUCTION_BY_SEVERITY,
  JD_MAX,
  JD_PROFILES,
  LOW_CONFIDENCE_REVIEW,
  MIN_COVERAGE_FOR_100,
  MODEL,
  NEGATIVE_SEVERITIES,
  type PointDef,
  POINTS_OF,
  PROMPT_VERSION,
  RUBRIC_VERSION,
  S_POINTS,
  S_PROFILES,
  SEVERITY_RETENTION,
  tierA,
  tierJ,
} from "./rubric";
import { designationListVersions, resolveSource } from "./designations";
import { lexiconVersion } from "./lexicon";
import type {
  Assessment,
  Claim,
  ConfidenceBand,
  ConductBreach,
  CriterionAssessment,
  Designation,
  Finding,
  LexiconHit,
  OrgResolution,
  Provenance,
  PtsSubScore,
  RejectedFinding,
  ReviewEntry,
  Scores,
  Severity,
  UnresolvedEntry,
} from "./types";

// ============================================================
// Evidence verification
// ============================================================

const QUOTE_MAP: Record<string, string> = {
  "\u2018": "'", "\u2019": "'", "\u201a": "'", "\u201b": "'",
  "\u201c": '"', "\u201d": '"', "\u201e": '"', "\u2033": '"',
  "\u2013": "-", "\u2014": "-", "\u2212": "-", "\u00a0": " ", "\u2026": "...",
};

export function _normalise(text: string): string {
  let out = "";
  for (const ch of text) out += QUOTE_MAP[ch] ?? ch;
  return out.toLowerCase().replace(/\s+/g, " ").trim();
}

const LABEL_PREFIX = /^(headline|standfirst|byline|published|source|body)\s*:\s*/;
export const APPROX_THRESHOLD = 0.85;

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    const cur = new Array<number>(n + 1);
    cur[0] = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

function ratio(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

function bestApproxRatio(part: string, text: string): number {
  if (!part) return 1;
  if (text.includes(part)) return 1;
  const L = part.length;
  if (L > text.length) return ratio(part, text);
  let best = 0;
  const step = Math.max(1, Math.floor(L / 5));
  for (let i = 0; i + L <= text.length; i += step) {
    const r = ratio(part, text.slice(i, i + L));
    if (r > best) best = r;
    if (best >= APPROX_THRESHOLD) return best;
  }
  return best;
}

export function verify_quote(
  quote: string,
  text: string,
): { found: boolean; approximate: boolean } {
  if (!quote) return { found: false, approximate: false };
  const normText = _normalise(text);
  const parts = _normalise(quote)
    .split(/\s*\.{2,}\s*/)
    .map((p) => p.replace(LABEL_PREFIX, "").trim())
    .filter(Boolean);
  if (parts.length === 0) return { found: false, approximate: false };
  let approximate = false;
  for (const part of parts) {
    if (normText.includes(part)) continue;
    if (bestApproxRatio(part, normText) >= APPROX_THRESHOLD) {
      approximate = true;
      continue;
    }
    return { found: false, approximate: false };
  }
  return { found: true, approximate };
}

export function quote_in_text(quote: string, text: string): boolean {
  return verify_quote(quote, text).found;
}

export function _sanitise_article(articleText: string): string {
  return articleText.replace(/<\/\s*ARTICLE\s*>/gi, "[/ARTICLE]");
}

// ============================================================
// Provenance
// ============================================================

export function _provenance(
  assessment: Assessment,
  articleText: string,
  designation: Designation,
  runId?: string | null,
): Provenance {
  const prov: Provenance = { ...(assessment._provenance as Provenance | undefined) };
  if (prov.prompt_version === undefined) prov.prompt_version = PROMPT_VERSION;
  if (prov.model === undefined) prov.model = MODEL;
  prov.rubric_version = RUBRIC_VERSION;
  prov.lexicon_version = lexiconVersion();
  prov.designation_list_versions = designationListVersions();
  prov.designation = designation;
  prov.run_id = runId || randomUUID();
  prov.timestamp_utc = new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
  prov.input_sha256 = createHash("sha256")
    .update(articleText, "utf-8")
    .digest("hex")
    .slice(0, 16);
  return prov;
}

// ============================================================
// Helpers
// ============================================================

function pyRound(x: number): number {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

function isNegative(sev: Severity): boolean {
  return (NEGATIVE_SEVERITIES as string[]).includes(sev);
}

function confidenceBand(value: number, unresolvedCount: number): ConfidenceBand {
  let band: ConfidenceBand =
    value >= CONFIDENCE_HIGH ? "HIGH" : value >= CONFIDENCE_MEDIUM ? "MEDIUM" : "LOW";
  if (unresolvedCount > 0 && band === "HIGH") band = "MEDIUM";
  return band;
}

// ============================================================
// Per-score evaluation (model criteria)
// ============================================================

type EvalConfig = {
  points: PointDef[];
  applicable: Set<string>;
  stanceGated: Set<string>;
  reviewReason: (cid: string) => string | null;
  capOf: (cid: string, item: CriterionAssessment, stance: string, sev: Severity) => number | null;
};

type EvalResult = {
  earned: number;
  assessed: number;
  applicable: number;
  findings: Finding[];
  rejected: RejectedFinding[];
  unresolved: UnresolvedEntry[];
  notApplicable: string[];
  reviewQueue: ReviewEntry[];
  caps: number[];
  capReasons: string[];
  materialConf: number[];
  passConf: number[];
  unresolvedCount: number;
};

function evaluateScore(
  cfg: EvalConfig,
  criteria: Record<string, CriterionAssessment>,
  articleText: string,
  overallStance: string,
  warnings: string[],
): EvalResult {
  const r: EvalResult = {
    earned: 0, assessed: 0, applicable: 0,
    findings: [], rejected: [], unresolved: [], notApplicable: [],
    reviewQueue: [], caps: [], capReasons: [],
    materialConf: [], passConf: [], unresolvedCount: 0,
  };

  const queue = (criterion: string, reason: string) => {
    if (!r.reviewQueue.some((e) => e.criterion === criterion && e.reason === reason)) {
      r.reviewQueue.push({ criterion, reason });
    }
  };

  for (const { id: cid, points } of cfg.points) {
    if (!cfg.applicable.has(cid)) continue;
    const item = criteria[cid];

    if (!item) {
      r.applicable += points;
      r.unresolved.push({ criterion: cid, reason: "model omitted this criterion", quote: "", rationale: "" });
      r.unresolvedCount++;
      queue(cid, "criterion not returned by the model");
      continue;
    }

    const sev = item.severity;
    if (sev === "NOT_APPLICABLE") {
      r.notApplicable.push(cid);
      continue;
    }

    r.applicable += points;

    if (sev === "UNRESOLVED") {
      r.unresolved.push({
        criterion: cid,
        reason: item.rationale || "insufficient/ambiguous evidence",
        quote: item.evidence_quote || "",
        rationale: item.rationale ?? "",
      });
      r.unresolvedCount++;
      queue(cid, "unresolved — insufficient or ambiguous evidence");
      continue;
    }

    if (sev === "PASS") {
      r.earned += points;
      r.assessed += points;
      if (typeof item.confidence === "number") r.passConf.push(item.confidence);
      continue;
    }

    if (!isNegative(sev)) {
      warnings.push(`${cid}: unknown severity ${sev}; treated as UNRESOLVED.`);
      r.unresolved.push({ criterion: cid, reason: `unknown severity ${sev}`, quote: "", rationale: "" });
      r.unresolvedCount++;
      queue(cid, "unknown severity");
      continue;
    }

    // Negative severity: verify the quote.
    const quote = item.evidence_quote || "";
    const check = verify_quote(quote, articleText);
    if (!check.found) {
      r.unresolved.push({
        criterion: cid,
        reason: "evidence quote not found in text (unverifiable)",
        quote,
        rationale: item.rationale ?? "",
      });
      r.unresolvedCount++;
      queue(cid, "quote unresolved — alleged failure not verifiable in text");
      continue;
    }

    const rawStance = item.failure_stance ?? "NONE";
    const stance = rawStance && rawStance !== "NONE" ? rawStance : overallStance;

    if (
      cfg.stanceGated.has(cid) &&
      stance !== "OWN_VOICE" &&
      stance !== "UNCRITICAL_AMPLIFICATION"
    ) {
      r.rejected.push({
        criterion: cid,
        reason: `stance rule: ${stance} cannot fail ${cid}`,
        quote,
        rationale: item.rationale ?? "",
      });
      r.earned += points;
      r.assessed += points;
      queue(cid, "stance rule refused the failure; check the stance classification");
      continue;
    }

    const retention = SEVERITY_RETENTION[sev] ?? 0;
    const earnedPts = points * retention;
    r.earned += earnedPts;
    r.assessed += points;
    r.findings.push({
      criterion: cid,
      severity: sev,
      points_lost: points - earnedPts,
      points_possible: points,
      stance,
      ihra_examples: item.ihra_examples ?? [],
      quote,
      quote_match: check.approximate ? "approximate" : "exact",
      section: item.section?.toString(),
      rationale: item.rationale ?? "",
      confidence: item.confidence ?? null,
    });
    if (typeof item.confidence === "number") r.materialConf.push(item.confidence);

    const cap = cfg.capOf(cid, item, stance, sev);
    if (cap !== null) {
      r.caps.push(cap);
      r.capReasons.push(
        cid === "S1"
          ? `${cid} headline/lead asserts an attributed claim as fact`
          : item.fabrication
            ? `${cid} fabrication (invented facts, quotes or source)`
            : `${cid} failed in the publication's own voice`,
      );
    }
    const rr = cfg.reviewReason(cid);
    if (rr) queue(cid, rr);
    if (item.human_review_required) queue(cid, "model requested review");
    const conf = item.confidence;
    if (typeof conf === "number" && conf < LOW_CONFIDENCE_REVIEW) {
      queue(cid, `low confidence (${conf.toFixed(2)})`);
    }
  }

  return r;
}

// ============================================================
// Conduct block (JD)
// ============================================================

function evaluateConduct(assessment: Assessment, articleText: string) {
  const breaches: ConductBreach[] = [];
  const rejected: RejectedFinding[] = [];
  const reviewQueue: ReviewEntry[] = [];
  const caps: number[] = [];
  const capReasons: string[] = [];
  let deduction = 0;

  for (const clause of assessment.conduct ?? []) {
    if (!(clause.engaged && clause.breached)) continue;
    // Conduct safeguards: privacy/harassment need a specific identified person.
    if ((clause.clause === "5" || clause.clause === "7") && !clause.person?.trim()) {
      rejected.push({
        criterion: `D${clause.clause}`,
        reason: "conduct clause requires a specific identified person; none given",
        quote: clause.evidence_quote || "",
        rationale: clause.rationale ?? "",
      });
      continue;
    }
    const quote = clause.evidence_quote || "";
    const check = verify_quote(quote, articleText);
    if (!check.found) {
      rejected.push({
        criterion: `D${clause.clause}`,
        reason: "evidence quote not found in text",
        quote,
        rationale: clause.rationale ?? "",
      });
      reviewQueue.push({ criterion: `D${clause.clause}`, reason: "conduct breach alleged without verifiable evidence" });
      continue;
    }
    const sev = (clause.severity as Severity) || "MAJOR";
    deduction += JD_DEDUCTION_BY_SEVERITY[sev] ?? 7;
    breaches.push({
      clause: clause.clause,
      severity: sev,
      quote,
      quote_match: check.approximate ? "approximate" : "exact",
      person: clause.person,
      rationale: clause.rationale ?? "",
      confidence: clause.confidence ?? null,
    });
    if (clause.clause === "8" && clause.fabrication) {
      caps.push(CAP_FABRICATION_J);
      capReasons.push("fabricated source (clause 8)");
    }
  }

  const earned = Math.max(0, JD_MAX - deduction);
  return { earned, possible: JD_MAX, breaches, rejected, reviewQueue, caps, capReasons };
}

// ============================================================
// Block S — deterministic S5 (designated-source reliance)
// ============================================================

const MIL_WING_HINTS = [
  "brigade", "qassam", "external security", "military wing", "al-quds", "saraya",
];

function s5Eligible(res: OrgResolution): boolean {
  if (!res.resolved || !res.designated) return false;
  if (res.scope === "military_wing_only") {
    const q = res.query.toLowerCase();
    return MIL_WING_HINTS.some((h) => q.includes(h));
  }
  return true;
}

type S5Result = {
  rung: string | null;
  severity: Severity;
  deduction: number;
  cap: number | null;
  finding: Finding | null;
  review: ReviewEntry | null;
  resolutions: OrgResolution[];
};

const S5_QUALIFYING_TYPES = new Set([
  "casualties",
  "attribution_of_responsibility",
  "statistic",
  "event",
]);

function evaluateS5(claims: Claim[], articleText: string): S5Result {
  const points = POINTS_OF["S5"];
  const resolutions: OrgResolution[] = [];
  let worst: { rung: number; claim: Claim } | null = null;

  for (const claim of claims) {
    const named = claim.sources_named ?? [];
    const resolved = named.map((n) => resolveSource(n));
    resolutions.push(...resolved);
    if (!S5_QUALIFYING_TYPES.has(claim.type)) continue;
    if (claim.independent_corroboration) continue; // rung 5
    if (named.length === 0) continue;

    const allDesignated = resolved.every((r) => s5Eligible(r));
    const viaControlled = resolved.some((r) => r.via_controlled_body);
    if (!allDesignated) continue;

    const usedAsFact = (claim.used_in ?? []).some((u) =>
      ["headline", "lead", "body_own_voice"].includes(u),
    );

    let rung: number;
    if (usedAsFact) rung = 1;
    else if (viaControlled && !claim.control_disclosed) rung = 2;
    else if (!claim.control_disclosed) rung = 2;
    else if (claim.control_disclosed && !claim.marked_unverified) rung = 3;
    else continue; // rung 4 — disclosed + marked unverified → no deduction

    if (!worst || rung < worst.rung) worst = { rung, claim };
  }

  if (!worst) {
    return { rung: null, severity: "PASS", deduction: 0, cap: null, finding: null, review: null, resolutions };
  }

  const claim = worst.claim;
  const res = (claim.sources_named ?? []).map((n) => resolveSource(n)).find((r) => s5Eligible(r));
  const check = verify_quote(claim.claim, articleText);
  const base: Omit<Finding, "severity" | "points_lost" | "rung"> = {
    criterion: "S5",
    points_possible: points,
    stance: "N/A",
    ihra_examples: [],
    quote: claim.claim,
    quote_match: check.found ? (check.approximate ? "approximate" : "exact") : "unverified",
    section: "BODY",
    rationale:
      `Sourcing problem (not a claim of falsity): a material claim relies solely on ` +
      `${res?.canonical_name ?? "a designated organisation"} ` +
      `(${res?.authority ?? "?"} ${res?.scope ?? ""}${res?.via_controlled_body ? `, via ${res.via_controlled_body.name}` : ""}; ` +
      `list ${res?.list_version ?? "?"}) without independent corroboration.`,
    confidence: 0.9,
  };

  let severity: Severity;
  let deduction: number;
  let cap: number | null = null;
  const rungName = `rung ${worst.rung}`;
  if (worst.rung === 1) {
    severity = "SEVERE";
    deduction = points;
    cap = CAP_SOURCING_J;
  } else if (worst.rung === 2) {
    severity = "MAJOR";
    deduction = points;
  } else {
    severity = "MODERATE";
    deduction = Math.round(points / 2);
  }

  return {
    rung: rungName,
    severity,
    deduction,
    cap,
    finding: { ...base, severity, points_lost: deduction, rung: rungName },
    review:
      worst.rung === 1
        ? { criterion: "S5", reason: "designated-source rung 1 — established fact from a designated source" }
        : { criterion: "S5", reason: `designated-source ${rungName}` },
    resolutions,
  };
}

// ============================================================
// Sub-score assembly + definitive-100 gate
// ============================================================

function buildSubScore(args: {
  isJ: boolean;
  earned: number;
  assessed: number;
  applicable: number;
  findings: Finding[];
  rejected: RejectedFinding[];
  unresolved: UnresolvedEntry[];
  notApplicable: string[];
  review: ReviewEntry[];
  caps: number[];
  capReasons: string[];
  materialConf: number[];
  passConf: number[];
  unresolvedCount: number;
  conductBreaches?: ConductBreach[];
  headlineAssessed: boolean;
  tier: (s: number | null) => string;
}): PtsSubScore {
  const {
    isJ, earned, assessed, applicable, findings, rejected, unresolved,
    notApplicable, review, caps, capReasons, materialConf, passConf,
    unresolvedCount, conductBreaches, headlineAssessed, tier,
  } = args;

  const raw = assessed > 0 ? pyRound((100 * earned) / assessed) : null;
  const cap = caps.length ? Math.min(...caps) : null;
  const capApplied = cap !== null && raw !== null;
  const final = capApplied ? Math.min(raw, cap) : raw;

  const confValue =
    materialConf.length > 0
      ? Math.min(...materialConf)
      : passConf.length > 0
        ? passConf.reduce((a, b) => a + b, 0) / passConf.length
        : 1;
  const confidence = confidenceBand(confValue, unresolvedCount);
  const coveragePct = applicable > 0 ? pyRound((100 * assessed) / applicable) : 0;

  // Definitive-100 gate.
  let displayed = final;
  let inconclusive = false;
  let inconclusiveReason: string | null = null;
  if (final === 100) {
    const reasons: string[] = [];
    if (coveragePct < MIN_COVERAGE_FOR_100) reasons.push(`coverage ${coveragePct}% < ${MIN_COVERAGE_FOR_100}%`);
    if (unresolvedCount > 0) reasons.push(`${unresolvedCount} unresolved criteria`);
    if (confidence === "LOW") reasons.push("low confidence");
    if (isJ && !headlineAssessed) reasons.push("headline/lead not assessed");
    if (reasons.length) {
      displayed = 99;
      inconclusive = true;
      inconclusiveReason = `Perfect score withheld: ${reasons.join("; ")}.`;
    }
  }

  return {
    score: final,
    displayed_score: displayed,
    tier: tier(displayed),
    raw_before_cap: raw,
    cap_applied: capApplied,
    cap_reason: capApplied ? capReasons[caps.indexOf(cap!)] ?? capReasons[0] ?? null : null,
    earned: Math.round(earned * 100) / 100,
    possible: assessed,
    applicable,
    coverage_pct: coveragePct,
    coverage: `${assessed}/${applicable} points assessed (${coveragePct}% coverage)`,
    confidence,
    confidence_value: Math.round(confValue * 100) / 100,
    unresolved_count: unresolvedCount,
    inconclusive,
    inconclusive_reason: inconclusiveReason,
    findings,
    rejected_findings: rejected,
    unresolved,
    not_applicable: notApplicable,
    human_review: review,
    conduct_breaches: conductBreaches,
  };
}

function emptySub(isJ: boolean): PtsSubScore {
  return {
    score: null, displayed_score: null, tier: "Not scored",
    raw_before_cap: null, cap_applied: false, cap_reason: null,
    earned: 0, possible: 0, applicable: 0, coverage_pct: 0,
    coverage: "0/0 points assessed", confidence: "LOW", confidence_value: 0,
    unresolved_count: 0, inconclusive: false, inconclusive_reason: null,
    findings: [], rejected_findings: [], unresolved: [], not_applicable: [],
    human_review: [], ...(isJ ? { conduct_breaches: [] } : {}),
  };
}

// ============================================================
// Main entry
// ============================================================

export type ScoreOptions = {
  designation?: Designation | string | null;
  runId?: string | null;
  lexiconHits?: LexiconHit[];
};

export function calculate_scores(
  assessment: Assessment,
  articleText: string,
  options: ScoreOptions = {},
): Scores {
  const warnings: string[] = [];
  const { runId, lexiconHits = [] } = options;

  let desig = (options.designation || assessment.designation || "ARTICLE")
    .toString()
    .toUpperCase() as Designation;
  if (!(desig in AS_PROFILES)) {
    warnings.push(`Unknown designation ${desig}; treated as ARTICLE.`);
    desig = "ARTICLE";
  }

  const legal = assessment.legal_flag ?? {
    possible_illegal: false, category: "NONE" as const, evidence_quote: "", rationale: "",
  };
  const provenance = _provenance(assessment, articleText, desig, runId);
  const claims = assessment.claims ?? [];
  const orgResolutions =
    desig === "SATIRE" ? [] : evaluateS5(claims, articleText).resolutions;

  if (desig === "SATIRE") {
    provenance.coverage_pct = 0;
    provenance.confidence = "LOW";
    return {
      pts_a: emptySub(false),
      pts_j: emptySub(true),
      headline_score: null,
      designation: desig,
      language: assessment.language,
      overall_stance: assessment.overall_stance,
      legal_flag: { ...legal, note: "Routing flag only. Not a legal finding." },
      summary: assessment.summary,
      candidate_passages: assessment.candidate_passages ?? [],
      three_d: assessment.three_d ?? [],
      claims,
      lexicon_hits: lexiconHits,
      org_resolutions: [],
      warnings,
      note: "Satire is labelled, not scored.",
      provenance,
    };
  }

  const criteria: Record<string, CriterionAssessment> = {};
  for (const item of assessment.criteria ?? []) {
    if (item.id in criteria) {
      warnings.push(`Duplicate criterion ${item.id}; first occurrence kept.`);
      continue;
    }
    criteria[item.id] = item;
  }
  const overallStance = assessment.overall_stance ?? "NONE";

  // ---- PTS-A ----
  const a = evaluateScore(
    {
      points: AS_POINTS,
      applicable: AS_PROFILES[desig],
      stanceGated: AS_STANCE_GATED,
      reviewReason: (cid) =>
        AS_CRITICAL.has(cid)
          ? "critical criterion failed — human review"
          : AS_CONTESTED.has(cid)
            ? "contested zone (IHRA 7-10 / 3D) — human review"
            : null,
      capOf: (cid, _item, stance, sev) =>
        AS_CRITICAL.has(cid) &&
        stance === "OWN_VOICE" &&
        (sev === "MAJOR" || sev === "SEVERE")
          ? CAP_CRITICAL_A
          : null,
    },
    criteria,
    articleText,
    overallStance,
    warnings,
  );

  applyThreeD(assessment, criteria, articleText, a);
  applyLexiconOverride(assessment, lexiconHits, overallStance, a);

  const pts_a = buildSubScore({
    isJ: false,
    earned: a.earned, assessed: a.assessed, applicable: a.applicable,
    findings: a.findings, rejected: a.rejected, unresolved: a.unresolved,
    notApplicable: a.notApplicable, review: a.reviewQueue,
    caps: a.caps, capReasons: a.capReasons,
    materialConf: a.materialConf, passConf: a.passConf,
    unresolvedCount: a.unresolvedCount,
    headlineAssessed: true,
    tier: tierA,
  });

  // ---- PTS-J ----
  const j = evaluateScore(
    {
      points: [...J_CORE_POINTS, ...S_POINTS.filter((p) => p.id !== "S5")],
      applicable: new Set([...J_PROFILES[desig], ...[...S_PROFILES[desig]].filter((id) => id !== "S5")]),
      stanceGated: new Set(),
      reviewReason: () => null,
      capOf: (cid, item, _stance, sev) => {
        if (cid === "J1" && item.fabrication && (sev === "MAJOR" || sev === "SEVERE")) return CAP_FABRICATION_J;
        if (cid === "S1" && sev === "SEVERE") return CAP_SOURCING_J;
        return null;
      },
    },
    criteria,
    articleText,
    overallStance,
    warnings,
  );

  // S5 — deterministic.
  const s5Applicable = S_PROFILES[desig].has("S5");
  const s5 = s5Applicable ? evaluateS5(claims, articleText) : null;
  if (s5) {
    const pts = POINTS_OF["S5"];
    j.applicable += pts;
    j.assessed += pts;
    j.earned += pts - s5.deduction;
    if (s5.finding) {
      j.findings.push(s5.finding);
      j.materialConf.push(0.9);
    } else {
      j.passConf.push(0.9);
    }
    if (s5.cap !== null) {
      j.caps.push(s5.cap);
      j.capReasons.push(`S5 ${s5.rung} — designated-source claim as established fact`);
    }
    if (s5.review) {
      if (!j.reviewQueue.some((e) => e.criterion === s5.review!.criterion && e.reason === s5.review!.reason)) {
        j.reviewQueue.push(s5.review);
      }
    }
  }

  // Conduct.
  let conductBreaches: ConductBreach[] = [];
  if (JD_PROFILES[desig]) {
    const c = evaluateConduct(assessment, articleText);
    j.earned += c.earned;
    j.assessed += c.possible;
    j.applicable += c.possible;
    conductBreaches = c.breaches;
    j.rejected.push(...c.rejected);
    for (const rv of c.reviewQueue) {
      if (!j.reviewQueue.some((e) => e.criterion === rv.criterion && e.reason === rv.reason)) {
        j.reviewQueue.push(rv);
      }
    }
    j.caps.push(...c.caps);
    j.capReasons.push(...c.capReasons);
  }

  const headlineAssessed =
    !!criteria["J4"] &&
    criteria["J4"].severity !== "UNRESOLVED" &&
    criteria["J4"].severity !== "NOT_APPLICABLE";

  const pts_j = buildSubScore({
    isJ: true,
    earned: j.earned, assessed: j.assessed, applicable: j.applicable,
    findings: j.findings, rejected: j.rejected, unresolved: j.unresolved,
    notApplicable: j.notApplicable, review: j.reviewQueue,
    caps: j.caps, capReasons: j.capReasons,
    materialConf: j.materialConf, passConf: j.passConf,
    unresolvedCount: j.unresolvedCount,
    conductBreaches,
    headlineAssessed,
    tier: tierJ,
  });

  const aDisp = pts_a.displayed_score;
  const jDisp = pts_j.displayed_score;
  const headline_score = aDisp !== null && jDisp !== null ? Math.min(aDisp, jDisp) : null;

  return {
    pts_a,
    pts_j,
    headline_score,
    designation: desig,
    language: assessment.language,
    overall_stance: assessment.overall_stance,
    legal_flag: { ...legal, note: "Routing flag only. Not a legal finding." },
    summary: assessment.summary,
    candidate_passages: assessment.candidate_passages ?? [],
    three_d: assessment.three_d ?? [],
    claims,
    lexicon_hits: lexiconHits,
    org_resolutions: orgResolutions,
    warnings,
    provenance: {
      ...provenance,
      coverage_pct: Math.round((pts_a.coverage_pct + pts_j.coverage_pct) / 2),
      confidence:
        pts_a.confidence === "LOW" || pts_j.confidence === "LOW"
          ? "LOW"
          : pts_a.confidence === "MEDIUM" || pts_j.confidence === "MEDIUM"
            ? "MEDIUM"
            : "HIGH",
    },
  };
}

// ============================================================
// Post-processing: 3D mapping + lexicon override
// ============================================================

function applyThreeD(
  assessment: Assessment,
  criteria: Record<string, CriterionAssessment>,
  articleText: string,
  a: EvalResult,
): void {
  for (const t of assessment.three_d ?? []) {
    if (!t.confirmed) continue;
    const stance = t.failure_stance && t.failure_stance !== "NONE" ? t.failure_stance : "OWN_VOICE";
    if (stance !== "OWN_VOICE" && stance !== "UNCRITICAL_AMPLIFICATION") continue;
    const cid = t.criterion;
    a.reviewQueue.push({ criterion: cid, reason: `3D ${t.dimension} confirmed — contested, human review` });
    const item = criteria[cid];
    const alreadyFound = a.findings.some((f) => f.criterion === cid);
    if (!alreadyFound && (!item || !(NEGATIVE_SEVERITIES as string[]).includes(item.severity))) {
      const check = verify_quote(t.evidence_quote || "", articleText);
      a.unresolved.push({
        criterion: cid,
        reason: `3D ${t.dimension} confirmed by the model but no matching criterion finding${check.found ? "" : " (quote unverified)"}`,
        quote: t.evidence_quote || "",
        rationale: t.rationale ?? "",
      });
      a.unresolvedCount++;
    }
  }
  // de-duplicate review queue
  a.reviewQueue = dedupeReview(a.reviewQueue);
}

function applyLexiconOverride(
  assessment: Assessment,
  hits: LexiconHit[],
  overallStance: string,
  a: EvalResult,
): void {
  const adj = assessment.lexicon_adjudications ?? [];
  const byId = new Map(adj.map((x) => [`${x.id}::${_normalise(x.matched_text)}`, x]));
  for (const hit of hits) {
    if (hit.strength === "not_indicator") continue;
    const key = `${hit.id}::${_normalise(hit.matched_text)}`;
    const a2 = byId.get(key) ?? adj.find((x) => x.id === hit.id);
    if (!a2) {
      if (hit.strength === "hard") {
        a.reviewQueue.push({ criterion: hit.criterion, reason: `lexicon hard hit not adjudicated (${hit.id})` });
      }
      continue;
    }
    const stance = a2.failure_stance && a2.failure_stance !== "NONE" ? a2.failure_stance : overallStance;
    if (!a2.trope_confirmed) {
      if (hit.strength === "hard" && (stance === "OWN_VOICE" || stance === "UNCRITICAL_AMPLIFICATION")) {
        a.reviewQueue.push({ criterion: hit.criterion, reason: `lexicon override — hard hit dismissed in own voice (${hit.id})` });
      }
      continue;
    }
    // Confirmed hit must appear as a criterion finding.
    const found = a.findings.some((f) => f.criterion === (a2.criterion || hit.criterion));
    if (!found) {
      a.unresolved.push({
        criterion: a2.criterion || hit.criterion,
        reason: `confirmed lexicon trope (${hit.id}) without a matching criterion finding`,
        quote: a2.matched_text,
        rationale: a2.reason ?? "",
      });
      a.unresolvedCount++;
      a.reviewQueue.push({ criterion: a2.criterion || hit.criterion, reason: `lexicon confirmed without finding (${hit.id})` });
    }
  }
  a.reviewQueue = dedupeReview(a.reviewQueue);
}

function dedupeReview(q: ReviewEntry[]): ReviewEntry[] {
  const seen = new Set<string>();
  const out: ReviewEntry[] = [];
  for (const e of q) {
    const k = `${e.criterion}::${e.reason}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

/**
 * Batch error-analysis label: predicted antisemitic when any accepted PTS-A
 * finding (excluding AS6) has stance OWN_VOICE or UNCRITICAL_AMPLIFICATION.
 */
export function predictedAntisemitic(scores: Scores): boolean {
  return (scores.pts_a.findings ?? []).some(
    (f) =>
      f.criterion !== "AS6" &&
      (f.stance === "OWN_VOICE" || f.stance === "UNCRITICAL_AMPLIFICATION"),
  );
}
