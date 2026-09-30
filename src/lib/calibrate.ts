// ============================================================
// Scoring calibration harness (Part 3).
//
// Runs a fixed set of deliberately-problematic and deliberately-neutral
// fixtures through the scorer BOTH ways — old (hardening off) and new
// (hardening on) — prints a "было / стало / ожидалось" table, and FAILS if a
// neutral fixture drops below 90 on either axis or a fixture lands outside its
// expected range. It is deterministic (no model calls): fixtures are built as
// Assessment objects, exactly like the unit tests.
// ============================================================

import { calculate_scores } from "./scorer";
import { MODEL_CRITERION_IDS } from "./rubric";
import { prescan } from "./lexicon";
import type { Assessment, CriterionAssessment, LexiconHit, ThreeDFinding } from "./types";

const MOCK_NA = new Set(["J3", "J7", "J8", "J9", "J10", "J11"]);
type Ov = Record<string, Partial<CriterionAssessment>>;

function mock(overrides: Ov = {}, extra: Partial<Assessment> = {}): Assessment {
  const base: Record<string, CriterionAssessment> = {};
  for (const cid of MODEL_CRITERION_IDS) {
    base[cid] = {
      id: cid,
      severity: MOCK_NA.has(cid) ? "NOT_APPLICABLE" : "PASS",
      evidence_quote: "",
      rationale: MOCK_NA.has(cid) ? "no publisher metadata" : "actively checked; clean",
      ihra_examples: [],
      confidence: 0.9,
      failure_stance: "NONE",
    };
  }
  for (const [cid, patch] of Object.entries(overrides)) {
    base[cid] = { ...base[cid], ...patch, id: cid };
  }
  return {
    summary: "calibration",
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

const hits = (article: string, lang = "en"): LexiconHit[] =>
  prescan([{ section: "BODY", text: article }], lang);

type Range = [number, number];
type Fixture = {
  name: string;
  kind: "problematic" | "neutral";
  article: string;
  assessment: Assessment;
  consistency?: number | null;
  lexiconHits?: LexiconHit[];
  designation?: string;
  expectA: Range;
  expectJ: Range;
};

// Legitimate but harsh criticism of Israeli policy — must NOT be penalised on
// PTS-A (IHRA caveat / 3D require a real mechanism, not mere severity).
const LEGIT_CRITICISM =
  "HEADLINE: Rights groups accuse the government of apartheid\n\nBODY: Human rights organisations said this week that the occupation amounts to apartheid and possible war crimes, citing settlement expansion and the blockade. Officials rejected the characterisation.";

const fixtures: Fixture[] = [
  // ---------------- Problematic (expected to be scored down) ----------------
  {
    name: "P1 own-voice AS2 conspiracy MODERATE (high consistency)",
    kind: "problematic",
    article: "the Jews secretly control the banks and the media",
    assessment: mock({
      AS2: { severity: "MODERATE", failure_stance: "OWN_VOICE", evidence_quote: "the Jews secretly control the banks and the media", ihra_examples: [2] },
    }),
    consistency: 1.0,
    expectA: [76, 82],
    expectJ: [96, 100],
  },
  {
    name: "P2 own-voice AS2 conspiracy SEVERE",
    kind: "problematic",
    article: "the Jews control everything and must be stopped",
    assessment: mock({
      AS2: { severity: "SEVERE", failure_stance: "OWN_VOICE", evidence_quote: "the Jews control everything and must be stopped", ihra_examples: [2] },
    }),
    consistency: 1.0,
    expectA: [36, 44],
    expectJ: [96, 100],
  },
  {
    name: "P3 Holocaust denial AS4 SEVERE own-voice (critical)",
    kind: "problematic",
    article: "the gas chambers are a convenient exaggeration",
    assessment: mock({
      AS4: { severity: "SEVERE", failure_stance: "OWN_VOICE", evidence_quote: "the gas chambers are a convenient exaggeration", ihra_examples: [4, 5] },
    }),
    consistency: 1.0,
    expectA: [36, 40],
    expectJ: [96, 100],
  },
  {
    name: "P4 Al-Jazeera-like AS6 MODERATE own-voice, consistency 0.00",
    kind: "problematic",
    article: "the article repeatedly foregrounds the community's identity while discussing the Holocaust",
    assessment: mock({
      AS6: { severity: "MODERATE", failure_stance: "OWN_VOICE", evidence_quote: "the article repeatedly foregrounds the community's identity while discussing the Holocaust", ihra_examples: [5] },
    }),
    consistency: 0.0,
    expectA: [76, 82],
    // Consistency is a SINGLE global reliability signal, so < 0.5 caps BOTH axes
    // at 85 and flags human review — even the axis without the fragile finding.
    expectJ: [84, 86],
  },
  {
    name: "P5 repeated AS2 trope across 3 passages (MODERATE own-voice)",
    kind: "problematic",
    article: "they sit on the boards of the banks; they own the newspapers; they instruct the government",
    assessment: mock({
      AS2: { severity: "MODERATE", failure_stance: "OWN_VOICE", occurrences: 3, evidence_quote: "they sit on the boards of the banks; they own the newspapers; they instruct the government", ihra_examples: [2] },
    }),
    consistency: 1.0,
    expectA: [66, 78],
    expectJ: [96, 100],
  },
  {
    name: "P6 PTS-J sourcing S1 SEVERE in the headline",
    kind: "problematic",
    article: "HUNDREDS KILLED IN STRIKE",
    assessment: mock({
      S1: { severity: "SEVERE", failure_stance: "OWN_VOICE", evidence_quote: "HUNDREDS KILLED IN STRIKE", section: "HEADLINE" },
    }),
    consistency: 1.0,
    expectA: [96, 100],
    expectJ: [36, 44],
  },
  {
    name: "P7 PTS-J accuracy J1 MAJOR own-voice",
    kind: "problematic",
    article: "the minister said the economy grew 40% last quarter",
    assessment: mock({
      J1: { severity: "MAJOR", failure_stance: "OWN_VOICE", evidence_quote: "the minister said the economy grew 40% last quarter" },
    }),
    consistency: 1.0,
    expectA: [96, 100],
    expectJ: [55, 64],
  },

  // ---------------- Neutral (must stay >= 90 on both axes) ----------------
  {
    name: "N1 clean neutral article",
    kind: "neutral",
    article: "City leaders opened a new downtown park on Monday with native plants and walking paths.",
    assessment: mock(),
    expectA: [100, 100],
    expectJ: [100, 100],
  },
  {
    name: "N2 legitimate harsh criticism of Israeli policy (IHRA/3D safe)",
    kind: "neutral",
    article: LEGIT_CRITICISM,
    assessment: mock({}, {
      three_d: [
        { dimension: "DOUBLE_STANDARDS", criterion: "AS5", confirmed: false, failure_stance: "NONE", evidence_quote: "", rationale: "no real comparison basis", confidence: 0.8 },
        { dimension: "DELEGITIMIZATION", criterion: "AS5", confirmed: false, failure_stance: "NONE", evidence_quote: "", rationale: "criticism of policy, not of self-determination", confidence: 0.8 },
      ] as ThreeDFinding[],
    }),
    lexiconHits: hits(LEGIT_CRITICISM),
    expectA: [90, 100],
    expectJ: [90, 100],
  },
  {
    name: "N3 not_indicator keywords only (apartheid/genocide)",
    kind: "neutral",
    article: "Critics described the policy as apartheid and warned of genocide during the debate.",
    assessment: mock(),
    lexiconHits: hits("Critics described the policy as apartheid and warned of genocide during the debate."),
    expectA: [100, 100],
    expectJ: [100, 100],
  },
  {
    name: "N4 antisemitic trope quoted then COUNTERED (stance gate)",
    kind: "neutral",
    article: "Some claim the Jews control the banks; this debunked conspiracy has been repeatedly refuted.",
    assessment: mock({
      AS2: { severity: "MAJOR", failure_stance: "COUNTERED", evidence_quote: "the Jews control the banks", ihra_examples: [2] },
    }),
    expectA: [100, 100],
    expectJ: [100, 100],
  },
  {
    name: "N5 partisan OPINION piece, no false facts",
    kind: "neutral",
    article: "OPINION: The government's housing policy is a moral failure and should be scrapped.",
    assessment: mock(),
    designation: "OPINION",
    expectA: [100, 100],
    expectJ: [100, 100],
  },
  {
    name: "N6 clean but one UNRESOLVED criterion (uncertainty, not a deduction)",
    kind: "neutral",
    article: "A report references Israel and Zionism but the passage is ambiguous and unverifiable.",
    assessment: mock({ AS5: { severity: "UNRESOLVED" } }),
    expectA: [95, 100],
    expectJ: [100, 100],
  },
  {
    name: "N7 boundary: a single MINOR AS6 stays at the floor (>= 90)",
    kind: "neutral",
    article: "the profile mentions the subject's heritage once in passing",
    assessment: mock({
      AS6: { severity: "MINOR", failure_stance: "OWN_VOICE", evidence_quote: "the profile mentions the subject's heritage once in passing" },
    }),
    consistency: 1.0,
    expectA: [90, 93],
    expectJ: [100, 100],
  },
];

function inRange(v: number | null, [lo, hi]: Range): boolean {
  return v !== null && v >= lo && v <= hi;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

export function runCalibration(): void {
  const rows: string[] = [];
  rows.push(
    `${pad("fixture", 52)} ${pad("axis", 5)} ${pad("было", 6)} ${pad("стало", 7)} ${pad("ожидалось", 12)} ok`,
  );
  rows.push("-".repeat(92));

  const failures: string[] = [];

  for (const fx of fixtures) {
    const common = {
      designation: fx.designation,
      lexiconHits: fx.lexiconHits,
      consistency: fx.consistency ?? null,
    };
    const oldS = calculate_scores(fx.assessment, fx.article, { ...common, hardening: false });
    const newS = calculate_scores(fx.assessment, fx.article, { ...common, hardening: true });

    for (const axis of ["A", "J"] as const) {
      const isA = axis === "A";
      const oldV = (isA ? oldS.pts_a : oldS.pts_j).displayed_score;
      const newV = (isA ? newS.pts_a : newS.pts_j).displayed_score;
      const exp = isA ? fx.expectA : fx.expectJ;
      const rangeOk = inRange(newV, exp);
      const neutralOk = fx.kind === "neutral" ? newV !== null && newV >= 90 : true;
      const ok = rangeOk && neutralOk;
      if (!ok) {
        failures.push(
          `${fx.name} [PTS-${axis}]: new=${newV} expected ${exp[0]}-${exp[1]}` +
            (fx.kind === "neutral" && !neutralOk ? " (neutral dropped below 90!)" : ""),
        );
      }
      rows.push(
        `${pad(fx.name, 52)} ${pad("PTS-" + axis, 5)} ${pad(String(oldV), 6)} ${pad(String(newV), 7)} ${pad(`${exp[0]}-${exp[1]}`, 12)} ${ok ? "ok" : "FAIL"}`,
      );
    }
  }

  console.log("\nSCORING CALIBRATION — было (hardening off) / стало (hardening on) / ожидалось\n");
  console.log(rows.join("\n"));
  console.log("");

  if (failures.length) {
    throw new Error(
      `Calibration FAILED (${failures.length}):\n` + failures.map((f) => "  - " + f).join("\n"),
    );
  }
  console.log(`Calibration passed: ${fixtures.length} fixtures (neutral floor >= 90 honoured).`);
}
