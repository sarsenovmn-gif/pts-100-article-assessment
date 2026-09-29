import { createHash, randomUUID } from "node:crypto";
import {
  AS_CONTESTED,
  AS_CRITICAL,
  AS_POINTS,
  AS_PROFILES,
  AS_STANCE_GATED,
  CAP_SCORE,
  CRITERION_IDS,
  J_POINTS,
  J_PROFILES,
  JD_DEDUCTION,
  JD_MAX,
  JD_PROFILES,
  LOW_CONFIDENCE_REVIEW,
  MODEL,
  type PointDef,
  PROMPT_VERSION,
  tierA,
  tierJ,
} from "./rubric";
import type {
  Assessment,
  ConductBreach,
  CriterionAssessment,
  Designation,
  Finding,
  Provenance,
  PtsSubScore,
  RejectedFinding,
  ReviewEntry,
  Scores,
} from "./types";

// ============================================================
// Evidence verification (mirrors _normalise / quote matching)
// ============================================================

const QUOTE_MAP: Record<string, string> = {
  "\u2018": "'",
  "\u2019": "'",
  "\u201a": "'",
  "\u201b": "'",
  "\u201c": '"',
  "\u201d": '"',
  "\u201e": '"',
  "\u2033": '"',
  "\u2013": "-",
  "\u2014": "-",
  "\u2212": "-",
  "\u00a0": " ",
  "\u2026": "...",
};

export function _normalise(text: string): string {
  let out = "";
  for (const ch of text) out += QUOTE_MAP[ch] ?? ch;
  return out.toLowerCase().replace(/\s+/g, " ").trim();
}

const LABEL_PREFIX = /^(headline|standfirst|byline|published|source|body)\s*:\s*/;
export const APPROX_THRESHOLD = 0.85;

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
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

/** Verify a model quote against the article (exact or approximate >= 0.85). */
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

/** A publication cannot close our data envelope. */
export function _sanitise_article(articleText: string): string {
  return articleText.replace(/<\/\s*ARTICLE\s*>/gi, "[/ARTICLE]");
}

// ============================================================
// Provenance
// ============================================================

export function _provenance(
  assessment: Assessment,
  articleText: string,
  runId?: string | null,
): Provenance {
  const prov: Provenance = { ...(assessment._provenance as Provenance | undefined) };
  if (prov.prompt_version === undefined) prov.prompt_version = PROMPT_VERSION;
  if (prov.model === undefined) prov.model = MODEL;
  prov.run_id = runId || randomUUID();
  prov.timestamp_utc = new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
  prov.input_sha256 = createHash("sha256")
    .update(articleText, "utf-8")
    .digest("hex")
    .slice(0, 16);
  return prov;
}

// ============================================================
// Deterministic two-score PTS scorer
// ============================================================

/** Python round(): round-half-to-even (banker's rounding). */
function pyRound(x: number): number {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

type EvalConfig = {
  points: PointDef[];
  applicable: Set<string>;
  stanceGated: Set<string>;
  reviewReason: (cid: string) => string | null;
  capOf: (cid: string, item: CriterionAssessment, stance: string) => string | null;
};

type EvalResult = {
  earned: number;
  possible: number;
  findings: Finding[];
  rejected: RejectedFinding[];
  notAssessable: string[];
  reviewQueue: ReviewEntry[];
  capApplied: boolean;
  capReason: string | null;
};

function evaluateScore(
  cfg: EvalConfig,
  criteria: Record<string, CriterionAssessment>,
  articleText: string,
  overallStance: string,
  warnings: string[],
): EvalResult {
  const findings: Finding[] = [];
  const rejected: RejectedFinding[] = [];
  const notAssessable: string[] = [];
  const reviewQueue: ReviewEntry[] = [];
  let earned = 0;
  let possible = 0;
  let capApplied = false;
  let capReason: string | null = null;

  const queue = (criterion: string, reason: string) => {
    if (!reviewQueue.some((e) => e.criterion === criterion && e.reason === reason)) {
      reviewQueue.push({ criterion, reason });
    }
  };

  for (const { id: cid, points } of cfg.points) {
    if (!cfg.applicable.has(cid)) continue;
    const item = criteria[cid];
    const status = item.status;
    // Stance fallback: an unspecified failure stance inherits overall_stance.
    const rawStance = item.failure_stance ?? "NONE";
    const stance = rawStance && rawStance !== "NONE" ? rawStance : overallStance;
    const quote = item.evidence_quote || "";

    if (status === "NOT_ASSESSABLE") {
      notAssessable.push(cid);
      continue;
    }

    possible += points;

    if (status === "PASS") {
      earned += points;
      continue;
    }

    if (status !== "FAIL") {
      warnings.push(`${cid}: unknown status ${status}; treated as NOT_ASSESSABLE.`);
      possible -= points;
      notAssessable.push(cid);
      continue;
    }

    const check = verify_quote(quote, articleText);
    if (!check.found) {
      rejected.push({
        criterion: cid,
        reason: "evidence quote not found in text",
        quote,
        rationale: item.rationale ?? "",
      });
      earned += points; // no quote, no deduction
      queue(cid, "model alleged a failure without verifiable evidence");
      continue;
    }

    if (
      cfg.stanceGated.has(cid) &&
      stance !== "OWN_VOICE" &&
      stance !== "UNCRITICAL_AMPLIFICATION"
    ) {
      rejected.push({
        criterion: cid,
        reason: `stance rule: ${stance} cannot fail ${cid}`,
        quote,
        rationale: item.rationale ?? "",
      });
      earned += points;
      queue(cid, "stance rule refused the failure; check the stance classification");
      continue;
    }

    findings.push({
      criterion: cid,
      points_lost: points,
      stance,
      ihra_examples: item.ihra_examples ?? [],
      quote,
      quote_match: check.approximate ? "approximate" : "exact",
      rationale: item.rationale ?? "",
      confidence: item.confidence ?? null,
    });

    const capR = cfg.capOf(cid, item, stance);
    if (capR) {
      capApplied = true;
      capReason = capR;
    }
    const rr = cfg.reviewReason(cid);
    if (rr) queue(cid, rr);
    if (item.human_review_required) queue(cid, "model requested review");
    const conf = item.confidence;
    if (
      LOW_CONFIDENCE_REVIEW &&
      typeof conf === "number" &&
      conf < LOW_CONFIDENCE_REVIEW
    ) {
      queue(cid, `low confidence (${conf.toFixed(2)})`);
    }
  }

  return {
    earned,
    possible,
    findings,
    rejected,
    notAssessable,
    reviewQueue,
    capApplied,
    capReason,
  };
}

type ConductResult = {
  earned: number;
  possible: number;
  breaches: ConductBreach[];
  rejected: RejectedFinding[];
  reviewQueue: ReviewEntry[];
  capApplied: boolean;
  capReason: string | null;
};

function evaluateConduct(
  assessment: Assessment,
  articleText: string,
): ConductResult {
  const breaches: ConductBreach[] = [];
  const rejected: RejectedFinding[] = [];
  const reviewQueue: ReviewEntry[] = [];
  let capApplied = false;
  let capReason: string | null = null;

  const queue = (criterion: string, reason: string) => {
    if (!reviewQueue.some((e) => e.criterion === criterion && e.reason === reason)) {
      reviewQueue.push({ criterion, reason });
    }
  };

  for (const clause of assessment.conduct ?? []) {
    if (!(clause.engaged && clause.breached)) continue;
    const quote = clause.evidence_quote || "";
    const check = verify_quote(quote, articleText);
    if (!check.found) {
      rejected.push({
        criterion: `D${clause.clause}`,
        reason: "evidence quote not found in text",
        quote,
        rationale: clause.rationale ?? "",
      });
      queue(`D${clause.clause}`, "conduct breach alleged without verifiable evidence");
      continue;
    }
    breaches.push({
      clause: clause.clause,
      quote,
      quote_match: check.approximate ? "approximate" : "exact",
      rationale: clause.rationale ?? "",
      confidence: clause.confidence ?? null,
    });
    if (clause.clause === "8" && clause.fabrication) {
      capApplied = true;
      capReason = "fabricated source (clause 8)";
    }
  }

  const earned = Math.max(0, JD_MAX - JD_DEDUCTION * breaches.length);
  return {
    earned,
    possible: JD_MAX,
    breaches,
    rejected,
    reviewQueue,
    capApplied,
    capReason,
  };
}

function rescale(earned: number, possible: number): number | null {
  if (possible <= 0) return null;
  return pyRound((100.0 * earned) / possible);
}

/**
 * Pure function: no network. Produces the two independent PTS-A and PTS-J
 * scores from the model's assessment.
 */
export function calculate_scores(
  assessment: Assessment,
  articleText: string,
  designation?: Designation | string | null,
  runId?: string | null,
): Scores {
  const warnings: string[] = [];

  let desig = (designation || assessment.designation || "ARTICLE")
    .toString()
    .toUpperCase() as Designation;
  if (!(desig in AS_PROFILES)) {
    warnings.push(`Unknown designation ${desig}; treated as ARTICLE.`);
    desig = "ARTICLE";
  }

  const legal = assessment.legal_flag ?? {
    possible_illegal: false,
    category: "NONE" as const,
    evidence_quote: "",
    rationale: "",
  };
  const provenance = _provenance(assessment, articleText, runId);

  if (desig === "SATIRE") {
    const none: PtsSubScore = {
      score: null,
      tier: "Not scored",
      raw_before_cap: null,
      cap_applied: false,
      cap_reason: null,
      earned: 0,
      possible: 0,
      coverage: "0/100 points assessable",
      findings: [],
      rejected_findings: [],
      not_assessable: [],
      human_review: [],
    };
    return {
      pts_a: none,
      pts_j: { ...none, conduct_breaches: [] },
      headline_score: null,
      designation: desig,
      language: assessment.language,
      overall_stance: assessment.overall_stance,
      legal_flag: { ...legal, note: "Routing flag only. Not a legal finding." },
      summary: assessment.summary,
      candidate_passages: assessment.candidate_passages ?? [],
      warnings,
      note: "Satire is labelled, not scored.",
      provenance,
    };
  }

  // Build criteria map (tolerate duplicates), require the full set.
  const criteria: Record<string, CriterionAssessment> = {};
  for (const item of assessment.criteria ?? []) {
    if (item.id in criteria) {
      warnings.push(`Duplicate criterion ${item.id}; first occurrence kept.`);
      continue;
    }
    criteria[item.id] = item;
  }
  const missing = CRITERION_IDS.filter((id) => !(id in criteria)).sort();
  if (missing.length) {
    throw new Error(`Model did not return criteria: ${missing.join(", ")}`);
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
            ? "contested zone (IHRA 7-10) — human review"
            : null,
      capOf: (cid, _item, stance) =>
        AS_CRITICAL.has(cid) && stance === "OWN_VOICE"
          ? `${cid} failed in the publication's own voice`
          : null,
    },
    criteria,
    articleText,
    overallStance,
    warnings,
  );
  const aRaw = rescale(a.earned, a.possible);
  const aFinal =
    a.capApplied && aRaw !== null ? Math.min(aRaw, CAP_SCORE) : aRaw;

  const pts_a: PtsSubScore = {
    score: aFinal,
    tier: tierA(aFinal),
    raw_before_cap: aRaw,
    cap_applied: a.capApplied,
    cap_reason: a.capReason,
    earned: a.earned,
    possible: a.possible,
    coverage: `${a.possible}/100 points assessable`,
    findings: a.findings,
    rejected_findings: a.rejected,
    not_assessable: a.notAssessable,
    human_review: a.reviewQueue,
  };

  // ---- PTS-J ----
  const j = evaluateScore(
    {
      points: J_POINTS,
      applicable: J_PROFILES[desig],
      stanceGated: new Set(), // stance gate is PTS-A only
      reviewReason: () => null,
      capOf: (cid, item) =>
        cid === "J1" && item.fabrication
          ? "J1 fabrication (invented facts or quotes)"
          : null,
    },
    criteria,
    articleText,
    overallStance,
    warnings,
  );

  let jEarned = j.earned;
  let jPossible = j.possible;
  let jCapApplied = j.capApplied;
  let jCapReason = j.capReason;
  const jRejected = [...j.rejected];
  const jReview = [...j.reviewQueue];
  let conductBreaches: ConductBreach[] = [];

  if (JD_PROFILES[desig]) {
    const c = evaluateConduct(assessment, articleText);
    jEarned += c.earned;
    jPossible += c.possible;
    conductBreaches = c.breaches;
    jRejected.push(...c.rejected);
    for (const r of c.reviewQueue) {
      if (!jReview.some((e) => e.criterion === r.criterion && e.reason === r.reason)) {
        jReview.push(r);
      }
    }
    if (c.capApplied) {
      jCapApplied = true;
      jCapReason = jCapReason ?? c.capReason;
    }
  }

  const jRaw = rescale(jEarned, jPossible);
  const jFinal =
    jCapApplied && jRaw !== null ? Math.min(jRaw, CAP_SCORE) : jRaw;

  const pts_j: PtsSubScore = {
    score: jFinal,
    tier: tierJ(jFinal),
    raw_before_cap: jRaw,
    cap_applied: jCapApplied,
    cap_reason: jCapReason,
    earned: jEarned,
    possible: jPossible,
    coverage: `${jPossible}/100 points assessable`,
    findings: j.findings,
    rejected_findings: jRejected,
    not_assessable: j.notAssessable,
    human_review: jReview,
    conduct_breaches: conductBreaches,
  };

  const headline_score =
    aFinal !== null && jFinal !== null ? Math.min(aFinal, jFinal) : null;

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
    warnings,
    provenance,
  };
}

/**
 * Batch error-analysis label: predicted antisemitic when any accepted PTS-A
 * deduction (excluding AS6) has stance OWN_VOICE or UNCRITICAL_AMPLIFICATION.
 */
export function predictedAntisemitic(scores: Scores): boolean {
  return (scores.pts_a.findings ?? []).some(
    (f) =>
      f.criterion !== "AS6" &&
      (f.stance === "OWN_VOICE" || f.stance === "UNCRITICAL_AMPLIFICATION"),
  );
}
