/**
 * Offline, deterministic demo of the strict two-score (v6) scorer.
 *
 *   npx tsx scripts/demo.mjs --demo-bad --debug
 *
 * `--demo-bad` feeds a SYNTHETIC antisemitic own-voice fixture together with a
 * hand-authored "model output" (what the assessment tool would return) through
 * the deterministic scorer. No network, no API key, no real usernames — this
 * exercises PTS-A severity retention, critical caps, coverage/confidence and
 * human review, plus PTS-J independently. `--debug` also prints the raw
 * assessment and the full scores object.
 */
import { calculate_scores } from "../src/lib/scorer.ts";
import { MODEL_CRITERION_IDS } from "../src/lib/rubric.ts";
import { prescan } from "../src/lib/lexicon.ts";

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

// Disclosure/ownership criteria that a bare text cannot support -> NOT_APPLICABLE.
const NOT_APPLICABLE = new Set(["J3", "J7", "J8", "J9", "J10", "J11"]);

// Graded, severity-based findings (what the model would return via the tool).
const FAILS = {
  AS1: {
    severity: "SEVERE",
    ihra_examples: [1],
    evidence_quote:
      "Decent citizens should drive them from public life by whatever means necessary, and we applaud those who confront them in the streets",
    rationale: "Justifies and celebrates harm against Jews in the publication's own voice.",
  },
  AS2: {
    severity: "SEVERE",
    ihra_examples: [2],
    evidence_quote:
      "the Jews secretly control the banks, the newspapers, the courts and every government ministry",
    rationale: "Classic world-conspiracy / Jewish-control trope asserted as fact.",
  },
  AS3: {
    severity: "MAJOR",
    ihra_examples: [6],
    evidence_quote: "Their dual loyalty to a foreign state proves they can never be trusted here",
    rationale: "Dual-loyalty accusation against Jews as a collective.",
  },
  AS4: {
    severity: "SEVERE",
    ihra_examples: [4, 5],
    evidence_quote: "the gas chambers are a convenient exaggeration invented to extort sympathy and money",
    rationale: "Holocaust denial / distortion in the publication's own voice.",
  },
  J1: {
    severity: "MAJOR",
    ihra_examples: [],
    evidence_quote:
      "the Jews secretly control the banks, the newspapers, the courts and every government ministry",
    rationale: "A central factual claim presented as established fact.",
  },
};

function buildBadAssessment() {
  const criteria = MODEL_CRITERION_IDS.map((id) => {
    if (FAILS[id]) {
      const f = FAILS[id];
      return {
        id,
        severity: f.severity,
        evidence_quote: f.evidence_quote,
        section: "BODY",
        rationale: f.rationale,
        ihra_examples: f.ihra_examples,
        confidence: 0.95,
        failure_stance: "OWN_VOICE",
        human_review_required: true,
      };
    }
    return {
      id,
      severity: NOT_APPLICABLE.has(id) ? "NOT_APPLICABLE" : "PASS",
      evidence_quote: "",
      rationale: NOT_APPLICABLE.has(id)
        ? "No publisher metadata in the supplied text to assess this criterion."
        : "Actively checked; no material concern beyond the recorded findings.",
      ihra_examples: [],
      confidence: 0.9,
      failure_stance: "NONE",
    };
  });

  return {
    summary:
      "[SYNTHETIC FIXTURE] Editorial asserting antisemitic conspiracy tropes, " +
      "incitement and Holocaust denial in its own voice.",
    language: "en",
    designation: "ARTICLE",
    overall_stance: "OWN_VOICE",
    candidate_passages: Object.values(FAILS).map((f) => f.evidence_quote),
    criteria,
    three_d: [],
    lexicon_adjudications: [
      {
        id: "holocaust_denial",
        matched_text: "so-called Holocaust",
        trope_confirmed: true,
        failure_stance: "OWN_VOICE",
        criterion: "AS4",
        reason: "Holocaust denial vocabulary confirmed in own voice.",
      },
    ],
    claims: [],
    conduct: [],
    legal_flag: {
      possible_illegal: true,
      category: "INCITEMENT",
      evidence_quote: "Decent citizens should drive them from public life by whatever means necessary",
      rationale:
        "Calls for driving Jews from public life by any means — possible incitement; route to a human.",
    },
    _provenance: { model: "offline-demo", prompt_version: "demo" },
  };
}

function main() {
  if (!args.has("--demo-bad")) {
    console.error("Usage: npx tsx scripts/demo.mjs --demo-bad [--debug]");
    process.exit(2);
  }

  const assessment = buildBadAssessment();
  const lexiconHits = prescan([{ section: "BODY", text: BAD_FIXTURE }], "en");
  const scores = calculate_scores(assessment, BAD_FIXTURE, {
    designation: "ARTICLE",
    runId: "demo-run",
    lexiconHits,
  });

  const line = (sub, code) =>
    `${code}: ${sub.displayed_score ?? "—"}/100  (${sub.tier})  ${sub.coverage}` +
    `  conf=${sub.confidence}` +
    (sub.unresolved_count ? `  unresolved=${sub.unresolved_count}` : "") +
    (sub.cap_applied ? `  [CAP ${sub.score}: ${sub.cap_reason}]` : "") +
    (sub.inconclusive ? `  [INCONCLUSIVE: ${sub.inconclusive_reason}]` : "");

  console.log("=== --demo-bad (synthetic antisemitic own-voice fixture) ===\n");
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
    `Provenance: run=${scores.provenance.run_id} model=${scores.provenance.model} ` +
      `rubric=${scores.provenance.rubric_version} lexicon=${scores.provenance.lexicon_version} ` +
      `sha256=${scores.provenance.input_sha256}`,
  );
  console.log(`Designation lists: ${(scores.provenance.designation_list_versions ?? []).join("; ")}`);

  if (debug) {
    console.log("\n=== --debug: lexicon pre-scan hits ===");
    console.log(JSON.stringify(lexiconHits, null, 2));
    console.log("\n=== --debug: raw assessment scored ===");
    console.log(JSON.stringify(assessment, null, 2));
    console.log("\n=== --debug: full scores object ===");
    console.log(JSON.stringify(scores, null, 2));
  }
}

main();
