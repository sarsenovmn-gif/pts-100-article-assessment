import { calculate_scores, predictedAntisemitic } from "./scorer";
import { MODEL_CRITERION_IDS } from "./rubric";
import { prescan } from "./lexicon";
import type {
  Assessment,
  Claim,
  ConductAssessment,
  CriterionAssessment,
  LexiconAdjudication,
  LexiconHit,
  ThreeDFinding,
} from "./types";

// ============================================================
// Fixtures & helpers
// ============================================================

/** A clean, neutral article with no Israel/Jewish/antisemitism content. */
export const CLEAN_ARTICLE = `HEADLINE: New downtown park opens to the public

BODY:
CHICAGO — City leaders opened a new two-acre green space in downtown Chicago on Monday morning, providing residents with a free public area featuring native plants, walking paths, and a children's playground. The project cost $4.2 million and took nearly two years to complete. "This space gives families a place to gather," said Mayor Sarah Jenkins during the ribbon-cutting ceremony.`;

/** Criteria the mock marks NOT_APPLICABLE (no publisher metadata in a sample). */
const MOCK_NA = new Set(["J3", "J7", "J8", "J9", "J10", "J11"]);

type Ov = Record<string, Partial<CriterionAssessment>>;

function mock(overrides: Ov = {}, extra: Partial<Assessment> = {}, drop: string[] = []): Assessment {
  const base: Record<string, CriterionAssessment> = {};
  for (const cid of MODEL_CRITERION_IDS) {
    if (drop.includes(cid)) continue;
    base[cid] = {
      id: cid,
      severity: MOCK_NA.has(cid) ? "NOT_APPLICABLE" : "PASS",
      evidence_quote: "",
      rationale: MOCK_NA.has(cid) ? "no publisher metadata to assess" : "actively checked; clean",
      ihra_examples: [],
      confidence: 0.9,
      failure_stance: "NONE",
    };
  }
  for (const [cid, patch] of Object.entries(overrides)) {
    base[cid] = { ...(base[cid] ?? { id: cid, severity: "PASS", evidence_quote: "", rationale: "", ihra_examples: [], confidence: 0.9, failure_stance: "NONE" }), ...patch, id: cid };
  }
  return {
    summary: "test",
    language: "en",
    designation: "ARTICLE",
    overall_stance: "OWN_VOICE",
    candidate_passages: [],
    criteria: Object.values(base),
    three_d: [],
    lexicon_adjudications: [],
    claims: [],
    conduct: [],
    legal_flag: { possible_illegal: false, category: "NONE", evidence_quote: "", rationale: "" },
    ...extra,
  };
}

function hitsFor(article: string, language = "en"): LexiconHit[] {
  return prescan([{ section: "BODY", text: article }], language);
}

function assert(cond: unknown, msg: string, ctx?: unknown): void {
  if (!cond) {
    throw new Error(
      `FAILED: ${msg}` + (ctx !== undefined ? `\n${JSON.stringify(ctx, null, 2)}` : ""),
    );
  }
}

type Fixture = { n: number; group: string; name: string; run: () => void };
const F: Fixture[] = [];
const fix = (n: number, group: string, name: string, run: () => void) =>
  F.push({ n, group, name, run });

// ============================================================
// Group 1 — Core scoring mechanics (1-6)
// ============================================================

fix(1, "scoring", "clean article earns a definitive 100/100", () => {
  const s = calculate_scores(mock(), CLEAN_ARTICLE);
  assert(s.pts_a.displayed_score === 100, "PTS-A should be 100", s.pts_a);
  assert(s.pts_j.displayed_score === 100, "PTS-J should be 100", s.pts_j);
  assert(s.headline_score === 100, "headline should be 100", s.headline_score);
  assert(s.pts_a.coverage_pct === 100, "PTS-A coverage 100%", s.pts_a.coverage_pct);
  assert(s.pts_j.coverage_pct === 100, "PTS-J coverage 100%", s.pts_j.coverage_pct);
  assert(s.pts_a.unresolved_count === 0, "no unresolved", s.pts_a);
  assert(s.pts_a.confidence === "HIGH", "confidence HIGH", s.pts_a.confidence);
  assert(!s.pts_a.inconclusive, "not inconclusive", s.pts_a);
});

fix(2, "scoring", "MODERATE severity retains 50% of the criterion's points", () => {
  const q = "the Jews secretly control the banks";
  const s = calculate_scores(
    mock({ AS2: { severity: "MODERATE", failure_stance: "OWN_VOICE", evidence_quote: q, ihra_examples: [2] } }),
    q,
  );
  const f = s.pts_a.findings.find((x) => x.criterion === "AS2");
  assert(f?.severity === "MODERATE", "AS2 finding MODERATE", s.pts_a.findings);
  assert(f?.points_lost === 10, "AS2 loses 10 of 20", f);
  assert(s.pts_a.displayed_score === 90, "PTS-A should be 90", s.pts_a);
});

fix(3, "scoring", "MINOR severity retains 75%", () => {
  const q = "readers were reminded of the community's identity";
  const s = calculate_scores(
    mock({ AS6: { severity: "MINOR", failure_stance: "OWN_VOICE", evidence_quote: q } }),
    q,
  );
  const f = s.pts_a.findings.find((x) => x.criterion === "AS6");
  assert(f?.severity === "MINOR", "AS6 finding MINOR", s.pts_a.findings);
  assert(f?.points_lost === 2.5, "AS6 loses 2.5 of 10", f);
  assert(s.pts_a.displayed_score === 98, "PTS-A should round to 98", s.pts_a);
});

fix(4, "scoring", "UNRESOLVED lowers coverage and blocks a definitive 100", () => {
  const s = calculate_scores(mock({ AS5: { severity: "UNRESOLVED" } }), CLEAN_ARTICLE);
  assert(s.pts_a.score === 100, "raw score is 100 (unresolved not counted)", s.pts_a);
  assert(s.pts_a.displayed_score === 99, "displayed withheld to 99", s.pts_a);
  assert(s.pts_a.inconclusive, "flagged inconclusive", s.pts_a);
  assert(s.pts_a.unresolved_count === 1, "one unresolved", s.pts_a);
  assert(s.pts_a.unresolved.some((u) => u.criterion === "AS5"), "AS5 unresolved", s.pts_a.unresolved);
  assert(s.pts_a.coverage_pct === 85, "coverage 85%", s.pts_a.coverage_pct);
});

fix(5, "scoring", "a criterion the model omits becomes UNRESOLVED, not a silent PASS", () => {
  const s = calculate_scores(mock({}, {}, ["AS3"]), CLEAN_ARTICLE);
  assert(s.pts_a.unresolved.some((u) => u.criterion === "AS3"), "AS3 unresolved", s.pts_a.unresolved);
  assert(
    s.pts_a.human_review.some((r) => r.criterion === "AS3"),
    "AS3 routed to human review",
    s.pts_a.human_review,
  );
  assert(s.pts_a.displayed_score !== 100, "cannot be a definitive 100", s.pts_a);
});

fix(6, "scoring", "critical AS4 SEVERE own-voice caps PTS-A at 39 (no stacking)", () => {
  const q = "the gas chambers are a convenient exaggeration";
  const s = calculate_scores(
    mock({ AS4: { severity: "SEVERE", failure_stance: "OWN_VOICE", evidence_quote: q, ihra_examples: [4, 5] } }),
    q,
  );
  assert(s.pts_a.cap_applied, "cap applied", s.pts_a);
  assert(s.pts_a.displayed_score === 39, "capped at 39", s.pts_a);
  assert(/own voice/i.test(s.pts_a.cap_reason ?? ""), "cap reason mentions own voice", s.pts_a.cap_reason);
  assert(s.pts_a.human_review.some((r) => r.criterion === "AS4"), "AS4 human review", s.pts_a.human_review);
  assert(s.pts_j.displayed_score === 100, "PTS-J untouched", s.pts_j);
});

// ============================================================
// Group 2 — Lexicon pre-scan & adjudication (7-14)
// ============================================================

fix(7, "lexicon", "a not_indicator keyword ALONE produces no deduction", () => {
  const article =
    "HEADLINE: Rights groups debate the policy\n\nBODY: Critics described the policy as apartheid, a contested legal term debated by scholars and diplomats at the summit this week.";
  const hits = hitsFor(article);
  assert(hits.some((h) => h.id === "ni_apartheid"), "apartheid detected as not_indicator", hits);
  const s = calculate_scores(mock(), article, { lexiconHits: hits });
  assert(s.pts_a.displayed_score === 100, "no deduction from keyword alone", s.pts_a);
  assert(s.pts_a.human_review.length === 0, "no review triggered", s.pts_a.human_review);
});

fix(8, "lexicon", "a confirmed HARD hit with a matching finding is scored", () => {
  const article = "HEADLINE: Screed\n\nBODY: They are the synagogue of satan and must be exposed.";
  const hits = hitsFor(article);
  assert(hits.some((h) => h.id === "synagogue_of_satan" && h.strength === "hard"), "hard hit found", hits);
  const adj: LexiconAdjudication = {
    id: "synagogue_of_satan",
    matched_text: "synagogue of satan",
    trope_confirmed: true,
    failure_stance: "OWN_VOICE",
    criterion: "AS2",
    reason: "demonising religious antisemitism",
  };
  const s = calculate_scores(
    mock(
      { AS2: { severity: "SEVERE", failure_stance: "OWN_VOICE", evidence_quote: "synagogue of satan", ihra_examples: [2] } },
      { lexicon_adjudications: [adj] },
    ),
    article,
    { lexiconHits: hits },
  );
  const f = s.pts_a.findings.find((x) => x.criterion === "AS2");
  assert(f?.severity === "SEVERE", "AS2 SEVERE finding", s.pts_a.findings);
  assert(s.pts_a.displayed_score === 80, "AS2 loses 20 -> 80", s.pts_a);
});

fix(9, "lexicon", "a HARD hit DISMISSED in own voice forces a lexicon-override review", () => {
  const article = "HEADLINE: Screed\n\nBODY: They are the synagogue of satan, the author writes approvingly.";
  const hits = hitsFor(article);
  const adj: LexiconAdjudication = {
    id: "synagogue_of_satan",
    matched_text: "synagogue of satan",
    trope_confirmed: false,
    failure_stance: "OWN_VOICE",
    criterion: "AS2",
    reason: "model claims it is not a trope",
  };
  const s = calculate_scores(mock({}, { lexicon_adjudications: [adj] }), article, { lexiconHits: hits });
  assert(
    s.pts_a.human_review.some((r) => r.criterion === "AS2" && /lexicon override/i.test(r.reason)),
    "lexicon override review present",
    s.pts_a.human_review,
  );
});

fix(10, "lexicon", "a CONFIRMED trope with no matching finding becomes UNRESOLVED", () => {
  const article = "HEADLINE: Screed\n\nBODY: They are the synagogue of satan.";
  const hits = hitsFor(article);
  const adj: LexiconAdjudication = {
    id: "synagogue_of_satan",
    matched_text: "synagogue of satan",
    trope_confirmed: true,
    failure_stance: "OWN_VOICE",
    criterion: "AS2",
    reason: "confirmed but model recorded AS2 as PASS",
  };
  const s = calculate_scores(mock({}, { lexicon_adjudications: [adj] }), article, { lexiconHits: hits });
  assert(s.pts_a.unresolved.some((u) => u.criterion === "AS2"), "AS2 unresolved", s.pts_a.unresolved);
  assert(
    s.pts_a.human_review.some((r) => /lexicon confirmed without finding/i.test(r.reason)),
    "review notes missing finding",
    s.pts_a.human_review,
  );
  assert(s.pts_a.displayed_score !== 100, "cannot be a definitive 100", s.pts_a);
});

fix(11, "lexicon", "an un-adjudicated HARD hit is routed to human review", () => {
  const article = "HEADLINE: Screed\n\nBODY: They are the synagogue of satan.";
  const hits = hitsFor(article);
  const s = calculate_scores(mock(), article, { lexiconHits: hits });
  assert(
    s.pts_a.human_review.some((r) => /not adjudicated/i.test(r.reason)),
    "hard hit not adjudicated -> review",
    s.pts_a.human_review,
  );
});

fix(12, "lexicon", "a SOFT hit dismissed in context does NOT force review", () => {
  const article = "HEADLINE: History\n\nBODY: The Rothschilds financed European railways during the 19th century, historians note.";
  const hits = hitsFor(article);
  assert(hits.some((h) => h.id === "rothschild_conspiracy" && h.strength === "soft"), "soft hit found", hits);
  const adj: LexiconAdjudication = {
    id: "rothschild_conspiracy",
    matched_text: "Rothschilds",
    trope_confirmed: false,
    failure_stance: "NONE",
    reason: "ordinary historical reference",
  };
  const s = calculate_scores(mock({}, { lexicon_adjudications: [adj] }), article, { lexiconHits: hits });
  assert(s.pts_a.human_review.length === 0, "no review for dismissed soft hit", s.pts_a.human_review);
  assert(s.pts_a.displayed_score === 100, "score unaffected", s.pts_a);
});

fix(13, "lexicon", "a SOFT hit confirmed as a control trope is scored", () => {
  const article = "HEADLINE: Screed\n\nBODY: Everyone knows the Jews own the media and manipulate the news.";
  const hits = hitsFor(article);
  assert(hits.some((h) => h.id === "owns_controls_media"), "control trope detected", hits);
  const adj: LexiconAdjudication = {
    id: "owns_controls_media",
    matched_text: "Jews own the media",
    trope_confirmed: true,
    failure_stance: "OWN_VOICE",
    criterion: "AS2",
    reason: "collective-control conspiracy",
  };
  const s = calculate_scores(
    mock(
      { AS2: { severity: "MAJOR", failure_stance: "OWN_VOICE", evidence_quote: "the Jews own the media", ihra_examples: [2] } },
      { lexicon_adjudications: [adj] },
    ),
    article,
    { lexiconHits: hits },
  );
  assert(s.pts_a.findings.some((x) => x.criterion === "AS2"), "AS2 finding present", s.pts_a.findings);
});

fix(14, "lexicon", "'Zionism' / 'Israel lobby' as ordinary politics is not_indicator", () => {
  const article =
    "HEADLINE: Politics\n\nBODY: Zionism is a political movement, and the Israel lobby is active in Washington, analysts say.";
  const hits = hitsFor(article);
  assert(hits.every((h) => h.strength === "not_indicator"), "only not_indicator hits", hits);
  const s = calculate_scores(mock(), article, { lexiconHits: hits });
  assert(s.pts_a.displayed_score === 100, "no deduction", s.pts_a);
  assert(s.pts_a.human_review.length === 0, "no review", s.pts_a.human_review);
});

// ============================================================
// Group 3 — IHRA / Sharansky 3D (15-20)
// ============================================================

fix(15, "3d", "a confirmed 3D DEMONIZATION mapped to AS5 with a finding routes to review", () => {
  const q = "the state is a uniquely evil cabal poisoning the world";
  const three_d: ThreeDFinding[] = [
    { dimension: "DEMONIZATION", criterion: "AS5", confirmed: true, failure_stance: "OWN_VOICE", evidence_quote: q, rationale: "demonising imagery", confidence: 0.9 },
  ];
  const s = calculate_scores(
    mock({ AS5: { severity: "MAJOR", failure_stance: "OWN_VOICE", evidence_quote: q, ihra_examples: [9] } }, { three_d }),
    q,
  );
  assert(
    s.pts_a.human_review.some((r) => r.criterion === "AS5" && /DEMONIZATION/.test(r.reason)),
    "3D demonization review present",
    s.pts_a.human_review,
  );
  assert(s.pts_a.findings.some((x) => x.criterion === "AS5"), "AS5 finding present", s.pts_a.findings);
});

fix(16, "3d", "a confirmed 3D with no matching criterion finding becomes UNRESOLVED", () => {
  const q = "they have no right to exist as a people";
  const three_d: ThreeDFinding[] = [
    { dimension: "DELEGITIMIZATION", criterion: "AS5", confirmed: true, failure_stance: "OWN_VOICE", evidence_quote: q, rationale: "denial of self-determination", confidence: 0.9 },
  ];
  const s = calculate_scores(mock({}, { three_d }), q);
  assert(
    s.pts_a.unresolved.some((u) => u.criterion === "AS5" && /DELEGITIMIZATION/.test(u.reason)),
    "AS5 unresolved from unmatched 3D",
    s.pts_a.unresolved,
  );
});

fix(17, "3d", "an UNCONFIRMED 3D finding has no effect", () => {
  const three_d: ThreeDFinding[] = [
    { dimension: "DOUBLE_STANDARDS", criterion: "AS5", confirmed: false, failure_stance: "NONE", evidence_quote: "", rationale: "no real comparison basis", confidence: 0.8 },
  ];
  const s = calculate_scores(mock({}, { three_d }), CLEAN_ARTICLE);
  assert(s.pts_a.displayed_score === 100, "score unaffected", s.pts_a);
  assert(s.pts_a.human_review.length === 0, "no review", s.pts_a.human_review);
});

fix(18, "3d", "a confirmed 3D in a COUNTERED stance is not deducted", () => {
  const q = "a fringe blogger called them a uniquely evil cabal";
  const three_d: ThreeDFinding[] = [
    { dimension: "DEMONIZATION", criterion: "AS5", confirmed: true, failure_stance: "COUNTERED", evidence_quote: q, rationale: "quoted then rebutted", confidence: 0.8 },
  ];
  const s = calculate_scores(mock({}, { three_d }), q);
  assert(s.pts_a.displayed_score === 100, "countered 3D not deducted", s.pts_a);
});

fix(19, "3d", "AS5 (contested) always routes to human review when it fails", () => {
  const q = "comparing the army's conduct directly to the Nazis";
  const s = calculate_scores(
    mock({ AS5: { severity: "MODERATE", failure_stance: "OWN_VOICE", evidence_quote: q, ihra_examples: [10] } }),
    q,
  );
  assert(
    s.pts_a.human_review.some((r) => r.criterion === "AS5" && /contested/i.test(r.reason)),
    "AS5 contested review",
    s.pts_a.human_review,
  );
});

fix(20, "3d", "AS5 failing under REPORTED_CONTEXTUALISED is refused by the stance gate", () => {
  const q = "one protester shouted that the country has no right to exist";
  const s = calculate_scores(
    mock({ AS5: { severity: "MODERATE", failure_stance: "REPORTED_CONTEXTUALISED", evidence_quote: q, ihra_examples: [7] } }),
    q,
  );
  assert(s.pts_a.rejected_findings.some((r) => r.criterion === "AS5"), "AS5 rejected by stance gate", s.pts_a.rejected_findings);
  assert(
    s.pts_a.human_review.some((r) => /stance rule/i.test(r.reason)),
    "stance classification queued for review",
    s.pts_a.human_review,
  );
  assert(s.pts_a.displayed_score === 100, "no deduction (earns full points)", s.pts_a);
});

// ============================================================
// Group 4 — Sourcing S1-S4 & headline/lead (21-25)
// ============================================================

fix(21, "sources", "S1 SEVERE (headline asserts attributed claim as fact) caps PTS-J at 59", () => {
  const q = "HUNDREDS KILLED IN STRIKE";
  const s = calculate_scores(
    mock({ S1: { severity: "SEVERE", failure_stance: "OWN_VOICE", evidence_quote: q, section: "HEADLINE" } }),
    q,
  );
  assert(s.pts_j.cap_applied, "cap applied", s.pts_j);
  assert(s.pts_j.displayed_score === 59, "capped at 59", s.pts_j);
  assert(/headline\/lead/i.test(s.pts_j.cap_reason ?? ""), "cap reason mentions headline/lead", s.pts_j.cap_reason);
});

fix(22, "sources", "S1 MODERATE does not trigger the sourcing cap", () => {
  const q = "officials described the figure as provisional";
  const s = calculate_scores(mock({ S1: { severity: "MODERATE", failure_stance: "OWN_VOICE", evidence_quote: q } }), q);
  assert(!s.pts_j.cap_applied, "no cap", s.pts_j);
  const f = s.pts_j.findings.find((x) => x.criterion === "S1");
  assert(f?.severity === "MODERATE", "S1 MODERATE finding", s.pts_j.findings);
});

fix(23, "sources", "J4 headline/body mismatch is a finding and headline is the weakest link", () => {
  const q = "headline overstates a tentative body claim";
  const s = calculate_scores(mock({ J4: { severity: "MAJOR", failure_stance: "OWN_VOICE", evidence_quote: q, section: "HEADLINE" } }), q);
  assert(s.pts_j.findings.some((x) => x.criterion === "J4"), "J4 finding", s.pts_j.findings);
  assert(s.headline_score === Math.min(s.pts_a.displayed_score!, s.pts_j.displayed_score!), "headline = min", s);
});

fix(24, "sources", "J1 fabrication caps PTS-J at 39", () => {
  const q = "a quote that was never said by the minister";
  const s = calculate_scores(mock({ J1: { severity: "MAJOR", failure_stance: "OWN_VOICE", evidence_quote: q, fabrication: true } }), q);
  assert(s.pts_j.cap_applied, "cap applied", s.pts_j);
  assert(s.pts_j.displayed_score === 39, "capped at 39", s.pts_j);
  assert(/fabrication/i.test(s.pts_j.cap_reason ?? ""), "cap reason mentions fabrication", s.pts_j.cap_reason);
});

fix(25, "sources", "caps do NOT stack — the lowest cap wins", () => {
  const q1 = "a quote that was never said by the minister";
  const q2 = "HUNDREDS KILLED IN STRIKE";
  const article = `${q1} ${q2}`;
  const s = calculate_scores(
    mock({
      J1: { severity: "MAJOR", failure_stance: "OWN_VOICE", evidence_quote: q1, fabrication: true },
      S1: { severity: "SEVERE", failure_stance: "OWN_VOICE", evidence_quote: q2, section: "HEADLINE" },
    }),
    article,
  );
  assert(s.pts_j.displayed_score === 39, "lowest cap (39) wins", s.pts_j);
});

// ============================================================
// Group 5 — Designated-source resolution & S5 ladder (26-35)
// ============================================================

function claim(patch: Partial<Claim>): Claim {
  return {
    claim: "at least 100 people were killed",
    type: "casualties",
    sources_named: [],
    sole_source: true,
    used_in: ["body_attributed"],
    control_disclosed: false,
    marked_unverified: false,
    independent_corroboration: false,
    ...patch,
  };
}

const CASUALTY_ARTICLE = "HEADLINE: Toll rises\n\nBODY: at least 100 people were killed, according to reports.";

fix(26, "designated", "S5 rung 1 (designated source as fact) is SEVERE and caps PTS-J at 59", () => {
  const s = calculate_scores(
    mock({}, { claims: [claim({ sources_named: ["Hamas"], used_in: ["body_own_voice"] })] }),
    CASUALTY_ARTICLE,
  );
  const f = s.pts_j.findings.find((x) => x.criterion === "S5");
  assert(f?.rung === "rung 1" && f.severity === "SEVERE", "S5 rung 1 SEVERE", s.pts_j.findings);
  assert(s.pts_j.cap_applied && s.pts_j.displayed_score === 59, "capped at 59", s.pts_j);
  assert(s.pts_j.human_review.some((r) => r.criterion === "S5"), "S5 human review", s.pts_j.human_review);
});

fix(27, "designated", "S5 rung 4 (disclosed + marked unverified) → no deduction", () => {
  const s = calculate_scores(
    mock({}, { claims: [claim({ sources_named: ["Hamas"], control_disclosed: true, marked_unverified: true })] }),
    CASUALTY_ARTICLE,
  );
  assert(!s.pts_j.findings.some((x) => x.criterion === "S5"), "no S5 finding", s.pts_j.findings);
  assert(s.pts_j.displayed_score === 100, "PTS-J 100", s.pts_j);
});

fix(28, "designated", "S5 rung 3 (disclosed, not marked unverified) → MODERATE half deduction", () => {
  const s = calculate_scores(
    mock({}, { claims: [claim({ sources_named: ["Hamas"], control_disclosed: true, marked_unverified: false })] }),
    CASUALTY_ARTICLE,
  );
  const f = s.pts_j.findings.find((x) => x.criterion === "S5");
  assert(f?.rung === "rung 3" && f.severity === "MODERATE", "S5 rung 3 MODERATE", s.pts_j.findings);
  assert(!s.pts_j.cap_applied, "no cap at rung 3", s.pts_j);
});

fix(29, "designated", "S5 rung 2 (attributed, control not disclosed) → MAJOR, no cap", () => {
  const s = calculate_scores(
    mock({}, { claims: [claim({ sources_named: ["Hamas"], control_disclosed: false })] }),
    CASUALTY_ARTICLE,
  );
  const f = s.pts_j.findings.find((x) => x.criterion === "S5");
  assert(f?.rung === "rung 2" && f.severity === "MAJOR", "S5 rung 2 MAJOR", s.pts_j.findings);
  assert(!s.pts_j.cap_applied, "no cap at rung 2", s.pts_j);
});

fix(30, "designated", "Hezbollah (military-wing-only) without a wing hint is NOT S5-eligible", () => {
  const s = calculate_scores(
    mock({}, { claims: [claim({ sources_named: ["Hezbollah"], used_in: ["body_own_voice"] })] }),
    CASUALTY_ARTICLE,
  );
  assert(!s.pts_j.findings.some((x) => x.criterion === "S5"), "no S5 finding (wing distinction)", s.pts_j.findings);
  assert(
    (s.org_resolutions ?? []).some((r) => r.canonical_name === "Hezbollah" && r.scope === "military_wing_only"),
    "resolution preserves military_wing_only scope",
    s.org_resolutions,
  );
});

fix(31, "designated", "Hezbollah with an explicit military-wing hint IS S5-eligible", () => {
  const s = calculate_scores(
    mock({}, { claims: [claim({ sources_named: ["Hezbollah military wing"], used_in: ["body_own_voice"] })] }),
    CASUALTY_ARTICLE,
  );
  assert(s.pts_j.findings.some((x) => x.criterion === "S5" && x.rung === "rung 1"), "S5 rung 1", s.pts_j.findings);
});

fix(32, "designated", "a controlled body (Gaza Government Media Office) resolves to its parent", () => {
  const s = calculate_scores(
    mock({}, { claims: [claim({ sources_named: ["Gaza Government Media Office"], control_disclosed: false })] }),
    CASUALTY_ARTICLE,
  );
  assert(
    (s.org_resolutions ?? []).some((r) => r.via_controlled_body?.name === "Gaza Government Media Office"),
    "resolved via controlled body",
    s.org_resolutions,
  );
  assert(s.pts_j.findings.some((x) => x.criterion === "S5" && x.rung === "rung 2"), "S5 rung 2", s.pts_j.findings);
});

fix(33, "designated", "a non-designated wire service triggers no S5 deduction", () => {
  const s = calculate_scores(
    mock({}, { claims: [claim({ sources_named: ["Reuters"], used_in: ["body_own_voice"] })] }),
    CASUALTY_ARTICLE,
  );
  assert((s.org_resolutions ?? []).some((r) => r.query === "Reuters" && !r.resolved), "Reuters unresolved", s.org_resolutions);
  assert(!s.pts_j.findings.some((x) => x.criterion === "S5"), "no S5 finding", s.pts_j.findings);
  assert(s.pts_j.displayed_score === 100, "PTS-J 100", s.pts_j);
});

fix(34, "designated", "independent corroboration (rung 5) removes the S5 deduction", () => {
  const s = calculate_scores(
    mock({}, { claims: [claim({ sources_named: ["Hamas"], used_in: ["body_own_voice"], independent_corroboration: true })] }),
    CASUALTY_ARTICLE,
  );
  assert(!s.pts_j.findings.some((x) => x.criterion === "S5"), "no S5 finding", s.pts_j.findings);
  assert((s.org_resolutions ?? []).some((r) => r.canonical_name === "Hamas"), "Hamas still resolved", s.org_resolutions);
});

fix(35, "designated", "a UN-listed org (Al-Qaeda) resolves via the UN authority", () => {
  const s = calculate_scores(
    mock({}, { claims: [claim({ sources_named: ["Al-Qaeda"], used_in: ["body_own_voice"] })] }),
    CASUALTY_ARTICLE,
  );
  assert((s.org_resolutions ?? []).some((r) => r.canonical_name === "Al-Qaeda" && r.authority === "UN"), "UN authority", s.org_resolutions);
  assert(s.pts_j.findings.some((x) => x.criterion === "S5" && x.rung === "rung 1"), "S5 rung 1", s.pts_j.findings);
});

// ============================================================
// Group 5b — Expanded seed data (controlled bodies + new orgs) (39-41)
// ============================================================

fix(39, "designated", "the Gaza Health Ministry resolves to Hamas via a controlled body (rung 2)", () => {
  const s = calculate_scores(
    mock({}, { claims: [claim({ sources_named: ["Gaza Health Ministry"], control_disclosed: false })] }),
    CASUALTY_ARTICLE,
  );
  assert(
    (s.org_resolutions ?? []).some(
      (r) => r.canonical_name === "Hamas" && r.via_controlled_body?.name === "Gaza Ministry of Health",
    ),
    "Gaza Health Ministry resolved to Hamas via controlled body",
    s.org_resolutions,
  );
  assert(s.pts_j.findings.some((x) => x.criterion === "S5" && x.rung === "rung 2"), "S5 rung 2", s.pts_j.findings);
});

fix(40, "designated", "an EU-listed org added in seed-2 (PKK) resolves and drives S5 rung 1", () => {
  const s = calculate_scores(
    mock({}, { claims: [claim({ sources_named: ["PKK"], used_in: ["body_own_voice"] })] }),
    CASUALTY_ARTICLE,
  );
  assert(
    (s.org_resolutions ?? []).some((r) => r.canonical_name === "Kurdistan Workers' Party" && r.authority === "EU"),
    "PKK resolved via EU authority",
    s.org_resolutions,
  );
  assert(s.pts_j.findings.some((x) => x.criterion === "S5" && x.rung === "rung 1"), "S5 rung 1", s.pts_j.findings);
});

fix(41, "designated", "an ISIL controlled body (Amaq) resolves to its parent", () => {
  const s = calculate_scores(
    mock({}, { claims: [claim({ sources_named: ["Amaq News Agency"], used_in: ["body_own_voice"] })] }),
    CASUALTY_ARTICLE,
  );
  assert(
    (s.org_resolutions ?? []).some(
      (r) => r.canonical_name === "Islamic State (ISIL / Da'esh)" && r.via_controlled_body?.name === "Amaq News Agency",
    ),
    "Amaq resolved via controlled body to Islamic State",
    s.org_resolutions,
  );
  assert(s.pts_j.findings.some((x) => x.criterion === "S5" && x.rung === "rung 1"), "S5 rung 1", s.pts_j.findings);
});

// ============================================================
// Group 5c — Expanded lexicon (English slurs + multilingual seeds) (42-44)
// ============================================================

fix(42, "lexicon", "an English anti-Jewish slur is detected as a HARD hit", () => {
  const article = "HEADLINE: Forum post removed\n\nBODY: A user called the columnist a kike, and moderators removed the post within minutes.";
  const hits = hitsFor(article);
  assert(hits.some((h) => h.id === "slurs_en" && h.strength === "hard"), "slur detected as hard", hits);
});

fix(43, "lexicon", "a German trope fires only when the article language is German", () => {
  const article = "SCHLAGZEILE: Debatte\n\nTEXT: Der Autor sprach abfaellig von der Judenpresse und einer angeblichen Weltjudentum-Verschwoerung.";
  const de = hitsFor(article, "de");
  const en = hitsFor(article, "en");
  assert(de.some((h) => h.id === "de_conspiracy_hard" && h.strength === "hard"), "German trope detected in de", de);
  assert(!en.some((h) => h.id === "de_conspiracy_hard"), "German-only trope not fired for en", en);
});

fix(44, "lexicon", "a not_indicator German term (Israelkritik) alone produces no deduction", () => {
  const article = "SCHLAGZEILE: Meinung\n\nTEXT: Sachliche Israelkritik an der Regierungspolitik ist legitim, sagte die Abgeordnete.";
  const hits = hitsFor(article, "de");
  assert(hits.some((h) => h.id === "de_ni_israelkritik" && h.strength === "not_indicator"), "Israelkritik is not_indicator", hits);
  const s = calculate_scores(mock({}, {}, []), article, { lexiconHits: hits });
  assert(s.pts_a.displayed_score === 100, "no deduction from a not_indicator hit", s.pts_a);
});

// ============================================================
// Group 6 — Designation profiles (OPINION / POST / SATIRE) (36-38)
// ============================================================

fix(36, "opinion", "OPINION covers the full AS block and the sourcing block", () => {
  const s = calculate_scores(mock(), CLEAN_ARTICLE, { designation: "OPINION" });
  assert(s.designation === "OPINION", "designation OPINION", s.designation);
  assert(s.pts_a.applicable === 100, "AS fully applicable", s.pts_a.applicable);
  assert(s.pts_a.displayed_score === 100 && s.pts_j.displayed_score === 100, "clean opinion 100/100", s);
});

fix(37, "opinion", "POST narrows PTS-J to J1/J2 + sourcing + conduct", () => {
  const s = calculate_scores(mock(), CLEAN_ARTICLE, { designation: "POST" });
  // J1(14)+J2(7) + S1(12)+S2(6)+S3(8)+S4(4) + S5(10) + JD(10) = 71
  assert(s.pts_j.applicable === 71, "POST PTS-J applicable = 71", s.pts_j.applicable);
  assert(s.pts_a.applicable === 100, "AS still fully applicable", s.pts_a.applicable);
});

fix(38, "opinion", "SATIRE is labelled, not scored", () => {
  const s = calculate_scores(mock(), CLEAN_ARTICLE, { designation: "SATIRE" });
  assert(s.pts_a.score === null && s.pts_j.score === null, "both scores null", s);
  assert(s.headline_score === null, "headline null", s.headline_score);
  assert((s.org_resolutions ?? []).length === 0, "no org resolutions for satire", s.org_resolutions);
});

// ============================================================
// Group 7 — Scoring hardening (Part 2) — { hardening: true } (45-53)
// ============================================================

const H = { hardening: true } as const;

fix(45, "hardening", "MODERATE worst finding caps the axis at 80", () => {
  const q = "the Jews secretly control the banks";
  const s = calculate_scores(mock({ AS2: { severity: "MODERATE", failure_stance: "OWN_VOICE", evidence_quote: q, ihra_examples: [2] } }), q, H);
  assert(s.pts_a.displayed_score === 80, "PTS-A capped at 80", s.pts_a);
  assert(s.pts_a.cap_applied && /MODERATE/.test(s.pts_a.cap_reason ?? ""), "cap reason cites severity", s.pts_a.cap_reason);
});

fix(46, "hardening", "MINOR worst finding caps the axis at 90", () => {
  const q = "the profile mentions the subject's heritage once";
  const s = calculate_scores(mock({ AS6: { severity: "MINOR", failure_stance: "OWN_VOICE", evidence_quote: q } }), q, H);
  assert(s.pts_a.displayed_score === 90, "PTS-A capped at 90", s.pts_a);
});

fix(47, "hardening", "MAJOR worst finding caps the axis at 60", () => {
  const q = "answer to tel aviv, the columnist wrote";
  const s = calculate_scores(mock({ AS3: { severity: "MAJOR", failure_stance: "OWN_VOICE", evidence_quote: q, ihra_examples: [6] } }), q, H);
  assert(s.pts_a.displayed_score === 60, "PTS-A capped at 60", s.pts_a);
});

fix(48, "hardening", "SEVERE (non-critical AS2) caps the axis at 40", () => {
  const q = "the Jews control everything and must be stopped";
  const s = calculate_scores(mock({ AS2: { severity: "SEVERE", failure_stance: "OWN_VOICE", evidence_quote: q, ihra_examples: [2] } }), q, H);
  assert(s.pts_a.displayed_score === 40, "PTS-A capped at 40", s.pts_a);
});

fix(49, "hardening", "OWN_VOICE applies a 1.5x penalty multiplier", () => {
  const q = "the profile foregrounds the subject's heritage";
  const s = calculate_scores(mock({ AS6: { severity: "MODERATE", failure_stance: "OWN_VOICE", evidence_quote: q } }), q, H);
  const f = s.pts_a.findings.find((x) => x.criterion === "AS6");
  assert(f?.points_lost === 7.5, "AS6 MODERATE own-voice loses 5 x 1.5 = 7.5", f);
});

fix(50, "hardening", "repeated occurrences add up with a diminishing coefficient", () => {
  const q = "they own the banks; they own the papers; they run the government";
  const s = calculate_scores(mock({ AS6: { severity: "MODERATE", failure_stance: "OWN_VOICE", occurrences: 2, evidence_quote: q } }), q, H);
  const f = s.pts_a.findings.find((x) => x.criterion === "AS6");
  // base 5 x occurrenceFactor(2)=1.5 x stance 1.5 = 11.25
  assert(f?.points_lost === 11.25, "two occurrences: 5 x 1.5 x 1.5 = 11.25", f);
});

fix(51, "hardening", "consistency < 0.5 forces LOW confidence, an 85 ceiling and review", () => {
  const q = "the profile mentions the subject's heritage once";
  const s = calculate_scores(
    mock({ AS6: { severity: "MINOR", failure_stance: "OWN_VOICE", evidence_quote: q } }),
    q,
    { ...H, consistency: 0.0 },
  );
  assert(s.pts_a.displayed_score === 85, "score ceiling 85 (min of 90 sev-cap and 85)", s.pts_a);
  assert(s.pts_a.confidence === "LOW", "confidence forced LOW", s.pts_a.confidence);
  assert(s.pts_a.human_review.some((r) => r.criterion === "CONSISTENCY"), "consistency review flag", s.pts_a.human_review);
});

fix(52, "hardening", "HIGH confidence is withheld when consistency is in [0.5, 0.8)", () => {
  const q = "the profile mentions the subject's heritage once";
  const s = calculate_scores(
    mock({ AS6: { severity: "MINOR", failure_stance: "OWN_VOICE", evidence_quote: q, confidence: 0.9 } }),
    q,
    { ...H, consistency: 0.6 },
  );
  assert(s.pts_a.confidence === "MEDIUM", "HIGH downgraded to MEDIUM", s.pts_a.confidence);
  assert(s.pts_a.displayed_score === 90, "no 85 ceiling above 0.5 consistency", s.pts_a);
});

fix(53, "hardening", "neutral: legitimate criticism / not_indicator stays 100 under hardening", () => {
  const article = "HEADLINE: Rights groups debate the policy\n\nBODY: Critics described the policy as apartheid and warned of occupation and possible war crimes at the summit.";
  const hits = hitsFor(article);
  const s = calculate_scores(mock(), article, { ...H, lexiconHits: hits });
  assert(s.pts_a.displayed_score === 100, "clean/legit criticism not penalised", s.pts_a);
  assert(s.pts_j.displayed_score === 100, "PTS-J clean", s.pts_j);
});

// ============================================================
// Conduct sanity + predictedAntisemitic (bundled into the run)
// ============================================================

function conductChecks(): void {
  const article = "HEADLINE: Report\n\nBODY: The private medical records of Jane Doe were published in full.";
  const conduct: ConductAssessment[] = [
    { clause: "7", engaged: true, breached: true, severity: "MAJOR", person: "Jane Doe", evidence_quote: "The private medical records of Jane Doe were published", rationale: "privacy intrusion", confidence: 0.9 },
    { clause: "7", engaged: true, breached: true, severity: "MAJOR", evidence_quote: "The private medical records of Jane Doe were published", rationale: "no person identified", confidence: 0.9 },
  ];
  const s = calculate_scores(mock({}, { conduct }), article);
  assert((s.pts_j.conduct_breaches?.length ?? 0) === 1, "only the breach with an identified person counts", s.pts_j.conduct_breaches);

  const bad = calculate_scores(
    mock({ AS2: { severity: "SEVERE", failure_stance: "OWN_VOICE", evidence_quote: "the Jews control the banks", ihra_examples: [2] } }),
    "the Jews control the banks",
  );
  assert(predictedAntisemitic(bad), "predictedAntisemitic true for own-voice AS2", bad.pts_a.findings);
  assert(!predictedAntisemitic(calculate_scores(mock(), CLEAN_ARTICLE)), "false for a clean article", null);
}

// ============================================================
// Runner
// ============================================================

export function selftest(): void {
  const failures: string[] = [];
  for (const f of F) {
    try {
      f.run();
    } catch (e) {
      failures.push(`  [${f.n}] (${f.group}) ${f.name}\n    ${(e as Error).message}`);
    }
  }
  try {
    conductChecks();
  } catch (e) {
    failures.push(`  [conduct] ${(e as Error).message}`);
  }
  if (failures.length) {
    throw new Error(`Self-test failed (${failures.length} of ${F.length + 1}):\n${failures.join("\n")}`);
  }
  console.log(`Self-test passed: ${F.length} regression fixtures + conduct/label checks.`);
}
