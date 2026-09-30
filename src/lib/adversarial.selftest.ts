import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculate_scores } from "./scorer";
import { MODEL_CRITERION_IDS } from "./rubric";
import { prescan } from "./lexicon";
import { detectInjection, normaliseForMatching } from "./normalise";
import { chunkBody } from "./chunk";
import { buildAssessment, computeConsistency, mergeRuns } from "./twopass";
import type {
  Assessment,
  CriterionAssessment,
  Judgement,
  JudgeVerdict,
  Prosecution,
  ProsecutorAllegation,
} from "./types";

const DIR = join(process.cwd(), "tests", "adversarial");
const fixture = (name: string): string => readFileSync(join(DIR, name), "utf-8");

function assert(cond: unknown, msg: string, ctx?: unknown): void {
  if (!cond) throw new Error(`FAILED: ${msg}` + (ctx !== undefined ? `\n${JSON.stringify(ctx, null, 2)}` : ""));
}

type Test = { name: string; run: () => void };
const T: Test[] = [];
const test = (name: string, run: () => void) => T.push({ name, run });

const MOCK_NA = new Set(["J3", "J7", "J8", "J9", "J10", "J11"]);
function cleanAssessment(text: string): Assessment {
  const criteria: CriterionAssessment[] = MODEL_CRITERION_IDS.map((id) => ({
    id,
    severity: MOCK_NA.has(id) ? "NOT_APPLICABLE" : "PASS",
    evidence_quote: "",
    rationale: "clean",
    ihra_examples: [],
    confidence: 0.9,
    failure_stance: "NONE",
  }));
  return {
    summary: text.slice(0, 40),
    language: "en",
    designation: "ARTICLE",
    overall_stance: "OWN_VOICE",
    candidate_passages: [],
    criteria,
    three_d: [],
    lexicon_adjudications: [],
    claims: [],
    conduct: [],
    legal_flag: { possible_illegal: false, category: "NONE", evidence_quote: "", rationale: "" },
  };
}

function judgement(verdicts: JudgeVerdict[], extra: Partial<Judgement> = {}): Judgement {
  return {
    verdicts,
    designation: "ARTICLE",
    language: "en",
    overall_stance: "OWN_VOICE",
    summary: "test",
    three_d: [],
    conduct: [],
    legal_flag: { possible_illegal: false, category: "NONE", evidence_quote: "", rationale: "" },
    ...extra,
  };
}

function alleg(patch: Partial<ProsecutorAllegation> & { id: string; criterion: string; quotes: string[] }): ProsecutorAllegation {
  return { stance: "OWN_VOICE", ihra_examples: [], argument: "", confidence: 0.8, ...patch };
}

// ============================================================
// Part C — input normalisation
// ============================================================

test("normalise: leetspeak fixture yields a lexicon hit after normalisation", () => {
  const text = fixture("leetspeak.txt");
  const hits = prescan([{ section: "BODY", text }], "en");
  const hit = hits.find((h) => h.id === "owns_controls_media");
  assert(hit, "owns_controls_media matched after de-leeting", hits);
  assert(hit!.normalised === true, "hit flagged as normalised", hit);
});

test("normalise: Cyrillic homoglyphs inside Latin words are folded for matching", () => {
  // 'Jews' and 'control' with Cyrillic е (U+0435) and о (U+043E).
  const text = "Everyone knows the J\u0435ws c\u043entrol the media in this town.";
  const hits = prescan([{ section: "BODY", text }], "en");
  assert(hits.some((h) => h.id === "owns_controls_media"), "homoglyph control trope matched", hits);
});

test("normalise: zero-width characters are stripped and separators collapsed", () => {
  const n1 = normaliseForMatching("J\u200bews");
  assert(n1.text === "jews", "zero-width stripped", n1.text);
  const n2 = normaliseForMatching("J.e.w.s");
  assert(n2.text === "jews", "in-word separators collapsed", n2.text);
});

test("normalise: position map slices the original leet token back out", () => {
  const text = "xx J3ws c0ntr0l the m3dia xx";
  const hits = prescan([{ section: "BODY", text }], "en");
  const hit = hits.find((h) => h.id === "owns_controls_media");
  assert(hit, "hit found", hits);
  assert(/J3ws/.test(hit!.matched_text), "matched_text is the ORIGINAL leet string", hit!.matched_text);
});

// ============================================================
// Part D — prompt-injection defence
// ============================================================

test("injection: fixture is flagged with the right labels", () => {
  const info = detectInjection(fixture("injection.txt"));
  assert(info.suspected, "injection suspected", info);
  const labels = info.passages.map((p) => p.label);
  assert(labels.includes("ignore previous instructions"), "ignore-instructions label", labels);
  assert(labels.some((l) => /pts 100|assign a score|compliant/i.test(l)), "score-manipulation label", labels);
});

test("injection: routes to human review while scores are still computed", () => {
  const text = fixture("injection.txt");
  const s = calculate_scores(cleanAssessment(text), text, { injection: detectInjection(text) });
  assert(s.injection?.suspected, "injection surfaced on the result", s.injection);
  assert(s.pts_a.human_review.some((r) => r.criterion === "INJECTION"), "PTS-A review has INJECTION", s.pts_a.human_review);
  assert(s.pts_j.human_review.some((r) => r.criterion === "INJECTION"), "PTS-J review has INJECTION", s.pts_j.human_review);
  assert(s.pts_a.displayed_score !== null, "scores still computed", s.pts_a);
});

test("injection: clean text is not flagged", () => {
  assert(!detectInjection("A perfectly ordinary sentence about parks and libraries.").suspected, "no false positive");
});

// ============================================================
// Part C2 — chunking
// ============================================================

test("chunking: long buried text splits into overlapping chunks", () => {
  const text = fixture("long_buried.txt");
  const chunks = chunkBody(text);
  assert(chunks.length > 1, "produced multiple chunks", chunks.length);
  const last = chunks[chunks.length - 1].text;
  assert(/secretly control the banks/.test(last), "buried antisemitic paragraph lands in the last chunk", last.slice(-200));
  // overlap: consecutive chunks share text
  assert(chunks[1].start < chunks[0].end, "chunks overlap", { a: chunks[0].end, b: chunks[1].start });
});

test("chunking: short text stays a single chunk", () => {
  const chunks = chunkBody("short body");
  assert(chunks.length === 1, "single chunk", chunks.length);
});

// ============================================================
// Part A — merge / consistency / build
// ============================================================

test("mergeRuns: unions allegations and records the runs each appeared in", () => {
  const runs: Prosecution[] = [
    { allegations: [alleg({ id: "x", criterion: "AS2", quotes: ["the Jews control the media"] })], candidate_passages: [], claims: [], dismissed_lexicon_hits: [] },
    { allegations: [alleg({ id: "y", criterion: "AS2", quotes: ["the Jews control the media"] }), alleg({ id: "z", criterion: "AS4", quotes: ["the Holocaust is a hoax"] })], candidate_passages: [], claims: [], dismissed_lexicon_hits: [] },
    { allegations: [alleg({ id: "w", criterion: "AS2", quotes: ["the Jews control the media"] })], candidate_passages: [], claims: [], dismissed_lexicon_hits: [] },
  ];
  const { merged } = mergeRuns(runs);
  const as2 = merged.find((a) => a.criterion === "AS2");
  const as4 = merged.find((a) => a.criterion === "AS4");
  assert(as2 && as2.runs?.length === 3, "AS2 present in all 3 runs", as2);
  assert(as4 && as4.runs?.length === 1, "AS4 present in 1 run", as4);
});

test("consistency: fraction of confirmed findings present in every run", () => {
  const merged: ProsecutorAllegation[] = [
    alleg({ id: "A1", criterion: "AS2", quotes: ["q"], runs: [0, 1, 2] }),
    alleg({ id: "A2", criterion: "AS4", quotes: ["q"], runs: [1] }),
  ];
  const verdicts: JudgeVerdict[] = [
    { allegation_id: "A1", verdict: "CONFIRMED", final_criterion: "AS2", final_stance: "OWN_VOICE", severity: "SEVERE", reason: "", confidence: 0.9 },
    { allegation_id: "A2", verdict: "CONFIRMED", final_criterion: "AS4", final_stance: "OWN_VOICE", severity: "SEVERE", reason: "", confidence: 0.9 },
  ];
  const { consistency } = computeConsistency(merged, verdicts, 3);
  assert(consistency === 0.5, "1 of 2 confirmed findings in every run -> 0.5", consistency);
});

test("build+score: split trope becomes ONE finding with three verified quotes", () => {
  const text = fixture("split_trope.txt");
  const quotes = [
    "sit on the boards of the largest banks",
    "own the newspapers that decide what the rest of us are allowed to think",
    "quietly instructs the government on",
  ];
  const merged = [alleg({ id: "A1", criterion: "AS2", quotes, confidence: 0.9 })];
  const j = judgement([
    { allegation_id: "A1", verdict: "CONFIRMED", final_criterion: "AS2", final_stance: "OWN_VOICE", severity: "MAJOR", reason: "trope across sentences", confidence: 0.9 },
  ]);
  const assessment = buildAssessment({ merged, judgement: j, candidate_passages: [], claims: [], dismissed: [], hits: [] });
  const s = calculate_scores(assessment, text);
  const f = s.pts_a.findings.find((x) => x.criterion === "AS2");
  assert(f, "AS2 finding present", s.pts_a.findings);
  assert(f!.quote_match !== "unverified", "all three quotes verified", f);
  assert(f!.quote.split("…").length === 3, "one finding carries three quotes", f!.quote);
});

test("build+score: 'some say' relay is amplification -> HALF deduction on AS2", () => {
  const text = fixture("some_say.txt");
  const merged = [alleg({ id: "A1", criterion: "AS2", quotes: ["the Jews control the media"], stance: "UNCRITICAL_AMPLIFICATION" })];
  const j = judgement([
    { allegation_id: "A1", verdict: "CONFIRMED", final_criterion: "AS2", final_stance: "UNCRITICAL_AMPLIFICATION", severity: "SEVERE", reason: "some say relay", confidence: 0.9 },
  ]);
  const assessment = buildAssessment({ merged, judgement: j, candidate_passages: [], claims: [], dismissed: [], hits: [] });
  const s = calculate_scores(assessment, text);
  const f = s.pts_a.findings.find((x) => x.criterion === "AS2");
  assert(f?.stance === "UNCRITICAL_AMPLIFICATION", "stance amplification", f);
  assert(f?.points_lost === 10, "SEVERE AS2 (20) halved to 10 for amplification", f);
});

test("build+score: countered trope is rejected -> no deduction", () => {
  const text = fixture("countered.txt");
  const merged = [alleg({ id: "A1", criterion: "AS2", quotes: ["the Jews control the banks and the media"], stance: "COUNTERED" })];
  const j = judgement([
    { allegation_id: "A1", verdict: "REJECTED", final_criterion: "AS2", final_stance: "COUNTERED", reason: "stance gate: COUNTERED", confidence: 0.9 },
  ]);
  const hits = prescan([{ section: "BODY", text }], "en");
  const assessment = buildAssessment({ merged, judgement: j, candidate_passages: [], claims: [], dismissed: [], hits });
  const s = calculate_scores(assessment, text, { lexiconHits: hits });
  assert(!s.pts_a.findings.some((x) => x.criterion === "AS2"), "no AS2 finding", s.pts_a.findings);
  assert(s.pts_a.displayed_score === 100, "PTS-A 100", s.pts_a);
});

test("build+score: unverifiable confirmed quote becomes UNRESOLVED, not a deduction", () => {
  const text = "A clean article about municipal parks and libraries.";
  const merged = [alleg({ id: "A1", criterion: "AS2", quotes: ["a quote that does not appear anywhere"] })];
  const j = judgement([
    { allegation_id: "A1", verdict: "CONFIRMED", final_criterion: "AS2", final_stance: "OWN_VOICE", severity: "SEVERE", reason: "x", confidence: 0.9 },
  ]);
  const assessment = buildAssessment({ merged, judgement: j, candidate_passages: [], claims: [], dismissed: [], hits: [] });
  const s = calculate_scores(assessment, text);
  assert(s.pts_a.unresolved.some((u) => u.criterion === "AS2"), "AS2 unresolved (quote not found)", s.pts_a.unresolved);
  assert(!s.pts_a.findings.some((x) => x.criterion === "AS2"), "no AS2 deduction", s.pts_a.findings);
});

// ============================================================
// Runner
// ============================================================

export function adversarialSelftest(): void {
  const failures: string[] = [];
  for (const t of T) {
    try {
      t.run();
    } catch (e) {
      failures.push(`  ${t.name}\n    ${(e as Error).message}`);
    }
  }
  if (failures.length) {
    throw new Error(`Adversarial self-test failed (${failures.length} of ${T.length}):\n${failures.join("\n")}`);
  }
  console.log(`Adversarial self-test passed: ${T.length} deterministic checks.`);
}
