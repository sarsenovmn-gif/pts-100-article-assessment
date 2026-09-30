/**
 * Offline, deterministic demo of the TWO-PASS (prosecutor → judge → scorer) model.
 *
 *   npx tsx scripts/demo.mjs --demo-bad --debug
 *
 * `--demo-bad` feeds a SYNTHETIC antisemitic own-voice fixture through the full
 * two-pass pipeline WITHOUT any network:
 *   1. three hand-authored prosecutor runs (recall pass, temp 0.7) are unioned
 *      by mergeRuns() so each allegation records the runs it appeared in;
 *   2. a hand-authored judge pass (precision, temp 0) CONFIRMs / DOWNGRADEs /
 *      REJECTs each allegation with the rule cited in `reason`;
 *   3. buildAssessment() turns the surviving verdicts into the Assessment the
 *      deterministic scorer consumes, and calculate_scores() produces PTS-A/PTS-J;
 *   4. computeConsistency() reports the run-to-run consistency index.
 *
 * No network, no API key, no real usernames — this exercises the merge/union,
 * consistency index, amplification half-deduction, quote verification, critical
 * caps and human-review routing. `--debug` also prints the prosecutor runs, the
 * judge verdicts, the built assessment and the full scores object.
 */
import { calculate_scores } from "../src/lib/scorer.ts";
import { prescan } from "../src/lib/lexicon.ts";
import {
  buildAssessment,
  computeConsistency,
  mergeRuns,
} from "../src/lib/twopass.ts";
import { PROSECUTOR_RUNS, PROSECUTOR_TEMPERATURE } from "../src/lib/rubric.ts";

const args = new Set(process.argv.slice(2));
const debug = args.has("--debug");

// Synthetic antisemitic own-voice fixture (for testing only; never for display).
const BAD_FIXTURE = `HEADLINE: The truth they will not print

BODY:
It is time we stated plainly what everyone privately knows: the Jews secretly
control the banks, the newspapers, the courts and every government ministry, and
they engineer our wars for their own profit while ordinary families suffer. This
cabal manipulates the economy to enrich itself. Decent citizens should drive them
from public life by whatever means necessary, and we applaud those who confront
them in the streets. As for the so-called Holocaust, the gas chambers are a
convenient exaggeration invented to extort sympathy and money from the rest of
us. Their dual loyalty to a foreign state proves they can never be trusted here.`;

// Each allegation the (synthetic) prosecutor would raise on this fixture.
const A = {
  AS1: {
    criterion: "AS1",
    quotes: [
      "Decent citizens should drive them from public life by whatever means necessary, and we applaud those who confront them in the streets",
    ],
    stance: "OWN_VOICE",
    ihra_examples: [1],
    argument: "Justifies and celebrates harm against Jews in the publication's own voice.",
    confidence: 0.95,
  },
  AS2: {
    criterion: "AS2",
    quotes: [
      "the Jews secretly control the banks, the newspapers, the courts and every government ministry",
    ],
    stance: "OWN_VOICE",
    ihra_examples: [2],
    argument: "Classic world-conspiracy / Jewish-control trope asserted as fact.",
    confidence: 0.95,
  },
  AS3: {
    criterion: "AS3",
    quotes: ["Their dual loyalty to a foreign state proves they can never be trusted here"],
    stance: "OWN_VOICE",
    ihra_examples: [6],
    argument: "Dual-loyalty accusation against Jews as a collective.",
    confidence: 0.9,
  },
  AS4: {
    criterion: "AS4",
    quotes: ["the gas chambers are a convenient exaggeration invented to extort sympathy and money"],
    stance: "OWN_VOICE",
    ihra_examples: [4, 5],
    argument: "Holocaust denial / distortion in the publication's own voice.",
    confidence: 0.95,
  },
  J1: {
    criterion: "J1",
    quotes: ["they engineer our wars for their own profit"],
    stance: "OWN_VOICE",
    ihra_examples: [],
    argument: "A central factual claim presented as established fact.",
    confidence: 0.8,
  },
};

// Three prosecutor runs (recall). AS1/AS2/AS4 recur in every run; AS3 appears in
// two runs and J1 in one, so the consistency index is deliberately < 1.
const PROSECUTOR_OUTPUT = [
  [A.AS1, A.AS2, A.AS3, A.AS4, A.J1],
  [A.AS1, A.AS2, A.AS3, A.AS4],
  [A.AS1, A.AS2, A.AS4],
];

// Severity + verdict the (synthetic) judge assigns per criterion.
const JUDGE_DECISIONS = {
  AS1: { verdict: "CONFIRMED", severity: "SEVERE", reason: "own voice; IHRA example 1 (incitement)" },
  AS2: { verdict: "CONFIRMED", severity: "SEVERE", reason: "own voice; IHRA example 2 (Jewish-control conspiracy)" },
  AS3: { verdict: "CONFIRMED", severity: "MAJOR", reason: "own voice; IHRA example 6 (dual loyalty)" },
  AS4: { verdict: "CONFIRMED", severity: "SEVERE", reason: "own voice; IHRA examples 4-5 (Holocaust denial)" },
  J1: { verdict: "CONFIRMED", severity: "MAJOR", reason: "material factual claim asserted as fact" },
};

function buildProsecution(allegations) {
  return {
    allegations: allegations.map((a) => ({ ...a })),
    candidate_passages: allegations.flatMap((a) => a.quotes),
    claims: [],
    dismissed_lexicon_hits: [],
  };
}

function buildJudgement(merged) {
  const verdicts = merged.map((a) => {
    const d = JUDGE_DECISIONS[a.criterion] ?? { verdict: "REJECTED", severity: "PASS", reason: "no rule engaged" };
    return {
      allegation_id: a.id,
      verdict: d.verdict,
      final_criterion: a.criterion,
      final_stance: a.stance,
      severity: d.severity,
      reason: d.reason,
      confidence: a.confidence,
    };
  });
  return {
    verdicts,
    designation: "ARTICLE",
    language: "en",
    overall_stance: "OWN_VOICE",
    summary:
      "[SYNTHETIC FIXTURE] Editorial asserting antisemitic conspiracy tropes, " +
      "incitement and Holocaust denial in its own voice.",
    three_d: [],
    conduct: [],
    legal_flag: {
      possible_illegal: true,
      category: "INCITEMENT",
      evidence_quote: "Decent citizens should drive them from public life by whatever means necessary",
      rationale:
        "Calls for driving Jews from public life by any means — possible incitement; route to a human.",
    },
  };
}

function main() {
  if (!args.has("--demo-bad")) {
    console.error("Usage: npx tsx scripts/demo.mjs --demo-bad [--debug]");
    process.exit(2);
  }

  const lexiconHits = prescan([{ section: "BODY", text: BAD_FIXTURE }], "en");

  // Pass 1 — prosecutor (union of N runs).
  const runs = PROSECUTOR_OUTPUT.map(buildProsecution);
  const { merged, candidate_passages, claims, dismissed } = mergeRuns(runs);

  // Pass 2 — judge (precision).
  const judgement = buildJudgement(merged);

  // Consistency index across the prosecutor runs.
  const { consistency, note } = computeConsistency(merged, judgement.verdicts, PROSECUTOR_RUNS);

  // Build the Assessment the deterministic scorer consumes, then score.
  const assessment = buildAssessment({ merged, judgement, candidate_passages, claims, dismissed, hits: lexiconHits });

  const audit = {
    prosecutor_runs: runs,
    merged_allegations: merged,
    verdicts: judgement.verdicts,
    dismissed_lexicon_hits: dismissed,
    consistency,
    consistency_note: note,
    irony_possible: false,
    chunking_used: false,
    normalisation_events: lexiconHits
      .filter((h) => h.normalised)
      .map((h) => ({ section: h.section, original: h.matched_text, normalised: h.normalisation_note ?? "" })),
  };

  const scores = calculate_scores(assessment, BAD_FIXTURE, {
    designation: "ARTICLE",
    runId: "demo-run",
    lexiconHits,
    consistency,
    consistencyNote: note,
    audit,
    provenanceExtra: {
      architecture: "two-pass (offline demo)",
      prosecutor_runs: PROSECUTOR_RUNS,
      prosecutor_temperature: PROSECUTOR_TEMPERATURE,
      judge_runs: 1,
    },
  });

  const line = (sub, code) =>
    `${code}: ${sub.displayed_score ?? "—"}/100  (${sub.tier})  ${sub.coverage}` +
    `  conf=${sub.confidence}` +
    (sub.unresolved_count ? `  unresolved=${sub.unresolved_count}` : "") +
    (sub.cap_applied ? `  [CAP ${sub.score}: ${sub.cap_reason}]` : "") +
    (sub.inconclusive ? `  [INCONCLUSIVE: ${sub.inconclusive_reason}]` : "");

  console.log("=== --demo-bad (synthetic antisemitic own-voice fixture, TWO-PASS) ===\n");

  console.log(`Prosecutor: ${PROSECUTOR_RUNS} runs at temperature ${PROSECUTOR_TEMPERATURE}`);
  runs.forEach((r, i) => {
    console.log(`  run ${i + 1}: ${r.allegations.map((a) => a.criterion).join(", ")}`);
  });
  console.log(`Merged allegations: ${merged.map((a) => `${a.id}=${a.criterion}(runs ${a.runs.join("/")})`).join(", ")}`);

  console.log("\nJudge verdicts:");
  for (const v of judgement.verdicts) {
    console.log(`  ${v.allegation_id} ${v.final_criterion}: ${v.verdict} [${v.severity}] — ${v.reason}`);
  }

  console.log(`\nConsistency index: ${consistency} — ${note}\n`);

  console.log(line(scores.pts_a, "PTS-A"));
  console.log(line(scores.pts_j, "PTS-J"));
  console.log(`Headline (weakest link): ${scores.headline_score ?? "—"}\n`);

  console.log("PTS-A findings:");
  for (const f of scores.pts_a.findings) {
    console.log(
      `  ${f.criterion} [${f.severity}] −${f.points_lost} [${f.stance}] (${f.quote_match}) IHRA ${f.ihra_examples.join(",")}`,
    );
  }
  console.log("PTS-A human review:");
  for (const r of scores.pts_a.human_review) console.log(`  ${r.criterion}: ${r.reason}`);

  console.log("\nPTS-J findings:");
  for (const f of scores.pts_j.findings) {
    console.log(`  ${f.criterion} [${f.severity}] −${f.points_lost} [${f.stance}] (${f.quote_match})`);
  }

  const legal = scores.legal_flag;
  console.log(
    `\nLegal flag: ${legal?.possible_illegal ? legal.category : "none"} — ${legal?.rationale ?? ""}`,
  );
  console.log(
    `Provenance: run=${scores.provenance.run_id} architecture=${scores.provenance.architecture} ` +
      `prosecutor_runs=${scores.provenance.prosecutor_runs} rubric=${scores.provenance.rubric_version} ` +
      `lexicon=${scores.provenance.lexicon_version} sha256=${scores.provenance.input_sha256}`,
  );
  console.log(`Designation lists: ${(scores.provenance.designation_list_versions ?? []).join("; ")}`);

  if (debug) {
    console.log("\n=== --debug: lexicon pre-scan hits ===");
    console.log(JSON.stringify(lexiconHits, null, 2));
    console.log("\n=== --debug: prosecutor runs ===");
    console.log(JSON.stringify(runs, null, 2));
    console.log("\n=== --debug: judge verdicts ===");
    console.log(JSON.stringify(judgement.verdicts, null, 2));
    console.log("\n=== --debug: built assessment ===");
    console.log(JSON.stringify(assessment, null, 2));
    console.log("\n=== --debug: full scores object ===");
    console.log(JSON.stringify(scores, null, 2));
  }
}

main();
