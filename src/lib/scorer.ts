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

/** True when the quote (after light normalisation) occurs in the text. */
export function quote_in_text(quote: string, text: string): boolean {
  const q = _normalise(quote);
  if (!q) return false;
  return _normalise(text).includes(q);
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

  for (const { id: cid, points: maxPoints } of POINTS) {
    if (!applicable.has(cid)) continue;
    const block = cid[0] as keyof BlockTotals;
    const item = criteria[cid];
    const status = item.status;
    const stance = item.failure_stance ?? "NONE";
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
    if (!quote_in_text(quote, articleText)) {
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
    summary: assessment.summary,
    warnings,
    provenance: _provenance(assessment, articleText, runId),
  };
}
