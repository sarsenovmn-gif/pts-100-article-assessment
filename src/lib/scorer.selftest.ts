import { calculate_pts100 } from "./scorer";
import { CRITERION_IDS } from "./rubric";
import type { Assessment, CriterionAssessment } from "./types";

export const SAMPLE_ARTICLE = `
CHICAGO — City leaders opened a new two-acre green space in downtown Chicago on Monday morning, providing residents with a free public area featuring native plants, walking paths, and a children's playground.
The project cost $4.2 million and took nearly two years to complete. Funded through a mix of municipal bonds and private donations, the park transforms a former industrial parking lot into a neighborhood hub.
"This space gives families a place to gather and breathe clean air," said Mayor Sarah Jenkins during the ribbon-cutting ceremony. Local business owners also praised the addition, noting it should increase foot traffic in the commercial district.
Construction crews added energy-efficient LED lighting and smart irrigation systems to minimize water waste. The park remains open daily from sunrise to sunset. City officials plan to host a weekend community festival next month to celebrate the opening.
`;

type CriterionOverride = Partial<CriterionAssessment>;

/** Mirrors the reference `_mock_assessment`. */
function mockAssessment(
  overrides: Record<string, CriterionOverride> = {},
): Assessment {
  const base: Record<string, CriterionAssessment> = {};
  for (const cid of CRITERION_IDS) {
    base[cid] = {
      id: cid,
      status: "PASS",
      evidence_quote: "",
      rationale: "ok",
      ihra_examples: [],
      confidence: 0.9,
      human_review_required: false,
      failure_stance: "NONE",
    };
  }
  for (const cid of ["B4", "C2", "C3"]) {
    base[cid].status = "NOT_ASSESSABLE";
  }
  for (const [cid, patch] of Object.entries(overrides)) {
    base[cid] = { ...base[cid], ...patch };
  }
  return {
    summary: "test",
    language: "en",
    designation: "ARTICLE",
    overall_stance: "OWN_VOICE",
    criteria: Object.values(base),
    conduct: [],
    legal_flag: {
      possible_illegal: false,
      category: "NONE",
      evidence_quote: "",
      rationale: "",
    },
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

/** Replicates the reference `selftest()` — 7 scenarios. */
export function selftest(): void {
  // 1. Clean article with three NOT_ASSESSABLE criteria must still reach 100.
  let s = calculate_pts100(mockAssessment(), SAMPLE_ARTICLE);
  assert(s.final_score === 100, "scenario 1: final_score should be 100", s);
  assert(
    s.points?.coverage === "88/100 points assessable",
    "scenario 1: coverage should be 88/100 points assessable",
    s.points,
  );

  // 2. A FAIL whose quote is not in the text is rejected: no deduction, review.
  s = calculate_pts100(
    mockAssessment({
      A1: {
        status: "FAIL",
        failure_stance: "OWN_VOICE",
        evidence_quote: "Jews control the city council",
        ihra_examples: [2],
      },
    }),
    SAMPLE_ARTICLE,
  );
  assert(
    s.final_score === 100 && (s.rejected_findings?.length ?? 0) > 0,
    "scenario 2: unverifiable A1 fail should be rejected, score 100",
    s,
  );
  assert(
    (s.human_review ?? []).some((r) => r.criterion === "A1"),
    "scenario 2: A1 should be queued for human review",
    s,
  );

  // 3. Verified own-voice A2 failure: deduction, cap 39, mandatory review.
  s = calculate_pts100(
    mockAssessment({
      A2: {
        status: "FAIL",
        failure_stance: "OWN_VOICE",
        evidence_quote: "breathe clean air",
        ihra_examples: [1],
        human_review_required: false,
      },
    }),
    SAMPLE_ARTICLE,
  );
  assert(
    s.cap_applied === true && s.final_score === 39,
    "scenario 3: verified own-voice A2 should cap at 39",
    s,
  );
  assert(
    (s.human_review ?? []).some((r) => r.criterion === "A2"),
    "scenario 3: A2 should be queued for human review",
    s,
  );

  // 4. Stance rule: A3 cannot fail when COUNTERED.
  s = calculate_pts100(
    mockAssessment({
      A3: {
        status: "FAIL",
        failure_stance: "COUNTERED",
        evidence_quote: "walking paths",
      },
    }),
    SAMPLE_ARTICLE,
  );
  assert(
    s.final_score === 100 && s.rejected_findings?.[0]?.criterion === "A3",
    "scenario 4: COUNTERED A3 fail should be rejected, score 100",
    s,
  );

  // 5. POST profile: only A1-A5, B1-B3 and Block D count; a B1 failure.
  s = calculate_pts100(
    mockAssessment({
      B1: {
        status: "FAIL",
        failure_stance: "OWN_VOICE",
        evidence_quote: "The project cost $4.2 million",
      },
    }),
    SAMPLE_ARTICLE,
    "POST",
  );
  assert(s.points?.possible.C === 0, "scenario 5: POST possible.C should be 0", s.points);
  assert(
    s.final_score === Math.round((100 * (77 - 7)) / 77),
    "scenario 5: POST B1 fail should score round(100*(77-7)/77)",
    s,
  );

  // 6. Block D: an unverifiable conduct breach is rejected; a verified one deducts 5.
  const a = mockAssessment();
  a.conduct = [
    {
      clause: "7",
      engaged: true,
      breached: true,
      evidence_quote: "not in the article",
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
  ];
  s = calculate_pts100(a, SAMPLE_ARTICLE);
  assert(
    s.points?.earned.D === 5 && s.rejected_findings?.length === 1,
    "scenario 6: one verified breach -> earned D 5, exactly 1 rejected",
    s,
  );

  // 7. Satire is labelled, not scored.
  s = calculate_pts100(mockAssessment(), SAMPLE_ARTICLE, "SATIRE");
  assert(s.final_score === null, "scenario 7: SATIRE final_score should be null", s);

  console.log("Self-test passed: 7 scenarios.");
}
