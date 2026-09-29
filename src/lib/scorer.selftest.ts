import { calculate_scores } from "./scorer";
import { CRITERION_IDS } from "./rubric";
import type {
  Assessment,
  ConductAssessment,
  CriterionAssessment,
} from "./types";

export const SAMPLE_ARTICLE = `
CHICAGO — City leaders opened a new two-acre green space in downtown Chicago on Monday morning, providing residents with a free public area featuring native plants, walking paths, and a children's playground.
The project cost $4.2 million and took nearly two years to complete. Funded through a mix of municipal bonds and private donations, the park transforms a former industrial parking lot into a neighborhood hub.
"This space gives families a place to gather and breathe clean air," said Mayor Sarah Jenkins during the ribbon-cutting ceremony. Local business owners also praised the addition, noting it should increase foot traffic in the commercial district.
Construction crews added energy-efficient LED lighting and smart irrigation systems to minimize water waste. The park remains open daily from sunrise to sunset. City officials plan to host a weekend community festival next month to celebrate the opening.
`;

type CriterionOverride = Partial<CriterionAssessment>;

/** Criteria the mock leaves NOT_ASSESSABLE (no publisher metadata in a sample). */
const MOCK_NOT_ASSESSABLE = new Set(["J3", "J7", "J8", "J9", "J11"]);

function mockAssessment(
  overrides: Record<string, CriterionOverride> = {},
  extra: Partial<Assessment> = {},
): Assessment {
  const base: Record<string, CriterionAssessment> = {};
  for (const cid of CRITERION_IDS) {
    base[cid] = {
      id: cid,
      status: MOCK_NOT_ASSESSABLE.has(cid) ? "NOT_ASSESSABLE" : "PASS",
      evidence_quote: "",
      rationale: "ok",
      ihra_examples: [],
      confidence: 0.9,
      human_review_required: false,
      failure_stance: "NONE",
    };
  }
  for (const [cid, patch] of Object.entries(overrides)) {
    base[cid] = { ...base[cid], ...patch };
  }
  return {
    summary: "test",
    language: "en",
    designation: "ARTICLE",
    overall_stance: "OWN_VOICE",
    candidate_passages: [],
    criteria: Object.values(base),
    conduct: [],
    legal_flag: {
      possible_illegal: false,
      category: "NONE",
      evidence_quote: "",
      rationale: "",
    },
    ...extra,
  };
}

function assert(cond: unknown, msg: string, ctx?: unknown): void {
  if (!cond) {
    throw new Error(
      `Self-test failed: ${msg}` +
        (ctx !== undefined ? `\n${JSON.stringify(ctx, null, 2)}` : ""),
    );
  }
}

/** Two-score scorer self-test — scenarios a-h. */
export function selftest(): void {
  // (a) Clean article: PTS-A 100 (full coverage) and PTS-J 100, but PTS-J
  //     coverage < 100 because J3/J7/J8/J9/J11 are NOT_ASSESSABLE.
  let s = calculate_scores(mockAssessment(), SAMPLE_ARTICLE);
  assert(s.pts_a.score === 100, "(a) PTS-A should be 100", s.pts_a);
  assert(s.pts_j.score === 100, "(a) PTS-J should be 100", s.pts_j);
  assert(
    s.pts_a.coverage === "100/100 points assessable",
    "(a) PTS-A coverage should be full",
    s.pts_a.coverage,
  );
  assert(
    s.pts_j.coverage === "70/100 points assessable",
    "(a) PTS-J coverage should be 70/100 (J3/J7/J8/J9/J11 N/A)",
    s.pts_j.coverage,
  );
  assert(
    ["J3", "J7", "J8", "J9", "J11"].every((c) =>
      s.pts_j.not_assessable.includes(c),
    ),
    "(a) PTS-J not_assessable should list J3/J7/J8/J9/J11",
    s.pts_j.not_assessable,
  );
  assert(s.headline_score === 100, "(a) headline (min) should be 100", s);

  // (b) AS2 + AS3 + AS4 fail in own voice: PTS-A capped at 39 (AS4 critical),
  //     human review contains AS4, and PTS-J is untouched (still 100).
  s = calculate_scores(
    mockAssessment({
      AS2: {
        status: "FAIL",
        failure_stance: "OWN_VOICE",
        evidence_quote: "breathe clean air",
        ihra_examples: [2],
      },
      AS3: {
        status: "FAIL",
        failure_stance: "OWN_VOICE",
        evidence_quote: "walking paths",
        ihra_examples: [3],
      },
      AS4: {
        status: "FAIL",
        failure_stance: "OWN_VOICE",
        evidence_quote: "The project cost $4.2 million",
        ihra_examples: [4],
      },
    }),
    SAMPLE_ARTICLE,
  );
  assert(
    s.pts_a.cap_applied === true && s.pts_a.score === 39,
    "(b) own-voice AS4 should cap PTS-A at 39",
    s.pts_a,
  );
  assert(
    s.pts_a.human_review.some((r) => r.criterion === "AS4"),
    "(b) AS4 should be queued for human review",
    s.pts_a.human_review,
  );
  assert(s.pts_j.score === 100, "(b) PTS-J should be unaffected", s.pts_j);

  // (c) AS2 fail with failure_stance NONE inherits overall_stance (OWN_VOICE),
  //     so it is deducted, not silently rejected.
  s = calculate_scores(
    mockAssessment({
      AS2: {
        status: "FAIL",
        failure_stance: "NONE",
        evidence_quote: "breathe clean air",
        ihra_examples: [2],
      },
    }),
    SAMPLE_ARTICLE,
  );
  assert(
    s.pts_a.findings.some((f) => f.criterion === "AS2"),
    "(c) AS2 (NONE stance) should be accepted via overall_stance fallback",
    s.pts_a,
  );
  assert(
    s.pts_a.score === 80 &&
      !s.pts_a.rejected_findings.some((r) => r.criterion === "AS2"),
    "(c) AS2 -20 should score 80, not be rejected",
    s.pts_a,
  );

  // (d) AS5 fail but stance COUNTERED: rejected by the stance gate, queued for
  //     review, no deduction.
  s = calculate_scores(
    mockAssessment({
      AS5: {
        status: "FAIL",
        failure_stance: "COUNTERED",
        evidence_quote: "walking paths",
        ihra_examples: [7],
      },
    }),
    SAMPLE_ARTICLE,
  );
  assert(
    s.pts_a.score === 100 &&
      s.pts_a.rejected_findings.some((r) => r.criterion === "AS5"),
    "(d) COUNTERED AS5 should be rejected, PTS-A 100",
    s.pts_a,
  );
  assert(
    s.pts_a.human_review.some((r) => r.criterion === "AS5"),
    "(d) AS5 should be queued for human review",
    s.pts_a.human_review,
  );

  // (e) POST designation: PTS-J covers only J1, J2, J5 and the conduct block.
  s = calculate_scores(mockAssessment(), SAMPLE_ARTICLE, "POST");
  assert(
    s.pts_j.possible === 20 + 10 + 7 + 20,
    "(e) POST PTS-J possible should be J1+J2+J5+JD = 57",
    s.pts_j.possible,
  );
  assert(
    s.pts_a.possible === 100,
    "(e) POST PTS-A should still cover all AS criteria",
    s.pts_a.possible,
  );

  // (f) J1 fabrication: PTS-J capped at 39, PTS-A untouched.
  s = calculate_scores(
    mockAssessment({
      J1: {
        status: "FAIL",
        failure_stance: "OWN_VOICE",
        evidence_quote: "The project cost $4.2 million",
        fabrication: true,
      },
    }),
    SAMPLE_ARTICLE,
  );
  assert(
    s.pts_j.cap_applied === true && s.pts_j.score === 39,
    "(f) J1 fabrication should cap PTS-J at 39",
    s.pts_j,
  );
  assert(s.pts_a.score === 100, "(f) PTS-A should be unaffected", s.pts_a);

  // (g) Conduct: an unverifiable breach is rejected; a verified one deducts 10
  //     from the JD block (PTS-J only).
  s = calculate_scores(
    mockAssessment(
      {},
      {
        conduct: [
          {
            clause: "7",
            engaged: true,
            breached: true,
            evidence_quote: "this text is not in the article at all",
            rationale: "",
            confidence: 0.8,
          },
          {
            clause: "5",
            engaged: true,
            breached: true,
            evidence_quote: "Mayor Sarah Jenkins",
            rationale: "",
            confidence: 0.8,
          },
        ] as ConductAssessment[],
      },
    ),
    SAMPLE_ARTICLE,
  );
  assert(
    (s.pts_j.conduct_breaches?.length ?? 0) === 1,
    "(g) exactly one conduct breach should be verified",
    s.pts_j.conduct_breaches,
  );
  assert(
    s.pts_j.rejected_findings.some((r) => r.criterion === "D7"),
    "(g) the unverifiable conduct breach (clause 7) should be rejected",
    s.pts_j.rejected_findings,
  );
  assert(
    s.pts_j.earned === 50 + 10,
    "(g) JD should lose 10 for the one verified breach (earned 60)",
    s.pts_j.earned,
  );
  assert(s.pts_a.score === 100, "(g) PTS-A should be unaffected", s.pts_a);

  // (h) Satire is labelled, not scored.
  s = calculate_scores(mockAssessment(), SAMPLE_ARTICLE, "SATIRE");
  assert(
    s.pts_a.score === null && s.pts_j.score === null,
    "(h) SATIRE should leave both scores null",
    s,
  );
  assert(
    s.headline_score === null,
    "(h) SATIRE headline should be null",
    s,
  );

  console.log("Self-test passed: 8 scenarios (a-h).");
}
