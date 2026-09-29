/**
 * Offline, deterministic demo of the two-score scorer.
 *
 *   npx tsx scripts/demo.mjs --demo-bad --debug
 *
 * `--demo-bad` feeds a SYNTHETIC antisemitic own-voice fixture together with a
 * hand-authored "model output" (what the assessment tool would return) through
 * the deterministic scorer. No network, no API key, no real usernames — this
 * exercises PTS-A caps/findings/review and PTS-J independently. `--debug` also
 * prints the raw assessment that was scored.
 */
import { calculate_scores } from "../src/lib/scorer.ts";

const args = new Set(process.argv.slice(2));
const debug = args.has("--debug");

// Synthetic antisemitic own-voice fixture (for testing only; never for display).
const BAD_FIXTURE = `EDITORIAL — The truth they will not print.
It is time we stated plainly what everyone privately knows: the Jews secretly
control the banks, the newspapers, the courts and every government ministry, and
they engineer our wars for their own profit while ordinary families suffer. This
cabal manipulates the economy to enrich itself. Decent citizens should drive them
from public life by whatever means necessary, and we applaud those who confront
them in the streets. As for the so-called Holocaust, the gas chambers are a
convenient exaggeration invented to extort sympathy and money from the rest of
us. Their dual loyalty to a foreign state proves they can never be trusted here.
We will not be silenced by their lies any longer.`;

const NOT_ASSESSABLE = new Set(["J3", "J7", "J8", "J9", "J11"]);
const ALL_IDS = [
  "AS1", "AS2", "AS3", "AS4", "AS5", "AS6",
  "J1", "J2", "J3", "J4", "J5", "J6", "J7", "J8", "J9", "J10", "J11",
];

const FAILS = {
  AS1: {
    ihra_examples: [1],
    quote:
      "Decent citizens should drive them from public life by whatever means necessary, and we applaud those who confront them in the streets",
    rationale: "Justifies and celebrates harm against Jews in the publication's own voice.",
  },
  AS2: {
    ihra_examples: [2],
    quote:
      "the Jews secretly control the banks, the newspapers, the courts and every government ministry",
    rationale: "Classic world-conspiracy / Jewish-control trope asserted as fact.",
  },
  AS3: {
    ihra_examples: [6],
    quote: "Their dual loyalty to a foreign state proves they can never be trusted here",
    rationale: "Dual-loyalty accusation against Jews as a collective.",
  },
  AS4: {
    ihra_examples: [4, 5],
    quote:
      "the gas chambers are a convenient exaggeration invented to extort sympathy and money",
    rationale: "Holocaust denial / distortion in the publication's own voice.",
  },
};

function buildBadAssessment() {
  const criteria = ALL_IDS.map((id) => {
    if (FAILS[id]) {
      const f = FAILS[id];
      return {
        id,
        status: "FAIL",
        evidence_quote: f.quote,
        rationale: f.rationale,
        ihra_examples: f.ihra_examples,
        confidence: 0.95,
        human_review_required: true,
        failure_stance: "OWN_VOICE",
      };
    }
    if (id === "J1") {
      return {
        id,
        status: "FAIL",
        evidence_quote:
          "the Jews secretly control the banks, the newspapers, the courts and every government ministry",
        rationale: "Significant factual inaccuracy presented as established fact.",
        ihra_examples: [],
        confidence: 0.9,
        human_review_required: false,
        failure_stance: "OWN_VOICE",
        fabrication: false,
      };
    }
    return {
      id,
      status: NOT_ASSESSABLE.has(id) ? "NOT_ASSESSABLE" : "PASS",
      evidence_quote: "",
      rationale: NOT_ASSESSABLE.has(id)
        ? "Not enough information in the supplied text to assess this criterion."
        : "ok",
      ihra_examples: [],
      confidence: 0.9,
      human_review_required: false,
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
    candidate_passages: Object.values(FAILS).map((f) => f.quote),
    criteria,
    conduct: [],
    legal_flag: {
      possible_illegal: true,
      category: "INCITEMENT",
      evidence_quote:
        "Decent citizens should drive them from public life by whatever means necessary",
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
  const scores = calculate_scores(assessment, BAD_FIXTURE, "ARTICLE", "demo-run");

  const line = (sub, code) =>
    `${code}: ${sub.score ?? "—"}/100  (${sub.tier})  ${sub.coverage}` +
    (sub.cap_applied ? `  [CAP 39: ${sub.cap_reason}]` : "");

  console.log("=== --demo-bad (synthetic antisemitic own-voice fixture) ===\n");
  console.log(line(scores.pts_a, "PTS-A"));
  console.log(line(scores.pts_j, "PTS-J"));
  console.log(`Headline (weakest link): ${scores.headline_score ?? "—"}\n`);

  console.log("PTS-A findings:");
  for (const f of scores.pts_a.findings) {
    console.log(`  ${f.criterion} −${f.points_lost} [${f.stance}] (${f.quote_match}) IHRA ${f.ihra_examples.join(",")}`);
  }
  console.log("PTS-A human review:");
  for (const r of scores.pts_a.human_review) console.log(`  ${r.criterion}: ${r.reason}`);

  console.log("\nPTS-J findings:");
  for (const f of scores.pts_j.findings) {
    console.log(`  ${f.criterion} −${f.points_lost} [${f.stance}] (${f.quote_match})`);
  }

  const legal = scores.legal_flag;
  console.log(
    `\nLegal flag: ${legal?.possible_illegal ? legal.category : "none"} — ${legal?.rationale ?? ""}`,
  );
  console.log(
    `Provenance: run=${scores.provenance.run_id} model=${scores.provenance.model} sha256=${scores.provenance.input_sha256}`,
  );

  if (debug) {
    console.log("\n=== --debug: raw assessment scored ===");
    console.log(JSON.stringify(assessment, null, 2));
    console.log("\n=== --debug: full scores object ===");
    console.log(JSON.stringify(scores, null, 2));
  }
}

main();
