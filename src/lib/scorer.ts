import { createHash, randomUUID } from "node:crypto";
import {
  BLOCK_D_DEDUCTION,
  BLOCK_D_MAX,
  CAP_SCORE,
  CONTESTED,
  CRITICAL,
  LOW_CONFIDENCE_REVIEW,
  MODEL,
  POINTS,
  PROFILES,
  PROMPT_VERSION,
  STANCE_GATED,
  tier,
} from "./rubric";
import type {
  Assessment,
  BlockTotals,
  ConductBreach,
  Designation,
  Finding,
  Provenance,
  RejectedFinding,
  ReviewEntry,
  ScoreResult,
} from "./types";

// ============================================================
// Evidence verification (mirrors _normalise / quote_in_text)
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

// Section labels the model must not include inside a quote (rule 8).
const LABEL_PREFIX = /^(headline|standfirst|byline|published|source|body)\s*:\s*/;

// Minimum similarity for an approximate (fuzzy) quote match.
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

/** Best fuzzy ratio of `part` against any similar-length window of `text`. */
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

/**
 * Verify a model quote against the article. Mirrors the corrected reference:
 * the quote is normalised, stripped of any section label, split on ellipsis
 * into parts, and each part must match the text either exactly or approximately
 * (ratio >= 0.85). Returns whether it was found and whether any part was only
 * an approximate match.
 */
export function verify_quote(
  quote: string,
  text: string,
): { found: boolean; approximate: boolean } {
  if (!quote) return { found: false, approximate: false };
  const normText = _normalise(text);
  const parts = _normalise(quote)
    .split(/\s*\.{2,}\s*/) // ellipsis (… -> ... , or ..) splits the quote
    .map((p) => p.replace(LABEL_PREFIX, "").trim())
    .filter(Boolean);
  if (parts.length === 0) return { found: false, approximate: false };

  let approximate = false;
  for (const part of parts) {
    if (normText.includes(part)) continue; // exact
    if (bestApproxRatio(part, normText) >= APPROX_THRESHOLD) {
      approximate = true;
      continue;
    }
    return { found: false, approximate: false };
  }
  return { found: true, approximate };
}

/** True when the quote occurs in the text (exact or approximate). */
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
// Deterministic PTS-100 scorer (mirrors calculate_pts100)
// ============================================================

/** Python round(): round-half-to-even (banker's rounding). */
function pyRound(x: number): number {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

/**
 * Pure function: no network. Applies every PTS-100 rule to the model's
 * assessment. Faithful port of the reference `calculate_pts100`.
 */
export function calculate_pts100(
  assessment: Assessment,
  articleText: string,
  designation?: Designation | string | null,
  runId?: string | null,
): ScoreResult {
  const warnings: string[] = [];
  const rejected: RejectedFinding[] = [];
  const reviewQueue: ReviewEntry[] = [];

  const queue = (criterion: string, reason: string) => {
    if (!reviewQueue.some((e) => e.criterion === criterion && e.reason === reason)) {
      reviewQueue.push({ criterion, reason });
    }
  };

  // ---- designation and profile ----
  let desig = (
    designation ||
    assessment.designation ||
    "ARTICLE"
  )
    .toString()
    .toUpperCase() as Designation;
  if (!(desig in PROFILES)) {
    warnings.push(`Unknown designation ${desig}; treated as ARTICLE.`);
    desig = "ARTICLE";
  }
  const applicable = PROFILES[desig];

  // ---- criteria map (tolerate duplicates) ----
  const criteria: Record<string, Assessment["criteria"][number]> = {};
  for (const item of assessment.criteria ?? []) {
    const cid = item.id;
    if (cid in criteria) {
      warnings.push(`Duplicate criterion ${cid}; first occurrence kept.`);
      continue;
    }
    criteria[cid] = item;
  }

  const allIds = POINTS.map((p) => p.id);
  const missing = allIds.filter((id) => !(id in criteria)).sort();
  if (missing.length && desig !== "SATIRE") {
    throw new Error(`Model did not return criteria: ${missing.join(", ")}`);
  }

  if (desig === "SATIRE") {
    return {
      designation: desig,
      final_score: null,
      tier: tier(null),
      note: "Satire is labelled, not scored.",
      legal_flag: assessment.legal_flag,
      provenance: _provenance(assessment, articleText, runId),
    };
  }

  // ---- criteria A–C ----
  const earned: BlockTotals = { A: 0, B: 0, C: 0, D: 0 };
  const possible: BlockTotals = { A: 0, B: 0, C: 0, D: 0 };
  const notAssessable: string[] = [];
  const findings: Finding[] = [];
  let capApplied = false;
  let capReason: string | null = null;

  const overallStance = assessment.overall_stance ?? "NONE";

  for (const { id: cid, points: maxPoints } of POINTS) {
    if (!applicable.has(cid)) continue;
    const block = cid[0] as keyof BlockTotals;
    const item = criteria[cid];
    const status = item.status;
    // Fix 1: when the model leaves failure_stance unspecified (NONE/empty),
    // fall back to the publication's overall stance so that genuine failures
    // are not silently discarded by the stance gate.
    const rawStance = item.failure_stance ?? "NONE";
    const stance =
      rawStance && rawStance !== "NONE" ? rawStance : overallStance;
    const quote = item.evidence_quote || "";

    if (status === "NOT_ASSESSABLE") {
      notAssessable.push(cid);
      continue;
    }

    possible[block] += maxPoints;

    if (status === "PASS") {
      earned[block] += maxPoints;
      continue;
    }

    if (status !== "FAIL") {
      warnings.push(`${cid}: unknown status ${status}; treated as NOT_ASSESSABLE.`);
      possible[block] -= maxPoints;
      notAssessable.push(cid);
      continue;
    }

    // ---- FAIL: rules that can refuse the deduction ----
    const check = verify_quote(quote, articleText);
    if (!check.found) {
      rejected.push({
        criterion: cid,
        reason: "evidence quote not found in text",
        quote,
        rationale: item.rationale ?? "",
      });
      earned[block] += maxPoints; // no quote, no deduction
      queue(cid, "model alleged a failure without verifiable evidence");
      continue;
    }

    if (
      STANCE_GATED.has(cid) &&
      stance !== "OWN_VOICE" &&
      stance !== "UNCRITICAL_AMPLIFICATION"
    ) {
      rejected.push({
        criterion: cid,
        reason: `stance rule: ${stance} cannot fail ${cid}`,
        quote,
        rationale: item.rationale ?? "",
      });
      earned[block] += maxPoints;
      queue(cid, "stance rule refused the failure; check the stance classification");
      continue;
    }

    // ---- accepted deduction ----
    findings.push({
      criterion: cid,
      points_lost: maxPoints,
      stance,
      ihra_examples: item.ihra_examples ?? [],
      quote,
      quote_approximate: check.approximate,
      rationale: item.rationale ?? "",
      confidence: item.confidence ?? null,
    });

    if (CRITICAL.has(cid)) {
      queue(cid, "critical criterion failed");
      if (stance === "OWN_VOICE") {
        capApplied = true;
        capReason = `${cid} failed in the publication's own voice`;
      }
    }
    if (CONTESTED.has(cid)) {
      queue(cid, "contested zone (IHRA 7-10) failed");
    }
    if (item.human_review_required) {
      queue(cid, "model requested review");
    }
    const conf = item.confidence;
    if (
      LOW_CONFIDENCE_REVIEW &&
      typeof conf === "number" &&
      conf < LOW_CONFIDENCE_REVIEW
    ) {
      queue(cid, `low confidence (${conf.toFixed(2)})`);
    }
  }

  // ---- Block D ----
  possible.D = BLOCK_D_MAX;
  const breached: ConductBreach[] = [];
  for (const clause of assessment.conduct ?? []) {
    if (!(clause.engaged && clause.breached)) continue;
    const quote = clause.evidence_quote || "";
    if (!quote_in_text(quote, articleText)) {
      rejected.push({
        criterion: `D${clause.clause}`,
        reason: "evidence quote not found in text",
        quote,
        rationale: clause.rationale ?? "",
      });
      queue(`D${clause.clause}`, "conduct breach alleged without verifiable evidence");
      continue;
    }
    breached.push({
      clause: clause.clause,
      quote,
      rationale: clause.rationale ?? "",
      confidence: clause.confidence ?? null,
    });
  }
  earned.D = Math.max(0, BLOCK_D_MAX - BLOCK_D_DEDUCTION * breached.length);

  // ---- score ----
  const totalPossible = possible.A + possible.B + possible.C + possible.D;
  const totalEarned = earned.A + earned.B + earned.C + earned.D;
  let rawScore: number | null = null;
  if (totalPossible > 0) {
    rawScore = pyRound((100.0 * totalEarned) / totalPossible);
  }
  let finalScore = rawScore;
  if (capApplied && rawScore !== null) {
    finalScore = Math.min(rawScore, CAP_SCORE);
  }

  const legal = assessment.legal_flag ?? {
    possible_illegal: false,
    category: "NONE" as const,
    evidence_quote: "",
    rationale: "",
  };

  return {
    designation: desig,
    language: assessment.language,
    overall_stance: assessment.overall_stance,
    final_score: finalScore,
    tier: tier(finalScore),
    raw_score_before_cap: rawScore,
    cap_applied: capApplied,
    cap_reason: capReason,
    points: {
      earned,
      possible,
      coverage: `${totalPossible}/100 points assessable`,
    },
    not_assessable: notAssessable,
    findings,
    conduct_breaches: breached,
    rejected_findings: rejected,
    human_review: reviewQueue,
    legal_flag: { ...legal, note: "Routing flag only. Not a legal finding." },
    candidate_passages: assessment.candidate_passages ?? [],
    summary: assessment.summary,
    warnings,
    provenance: _provenance(assessment, articleText, runId),
  };
}
