/**
 * Integration test for the /api/assess endpoint against a live model.
 *
 * Requires the dev server running (npm run dev) and a model key
 * (OPENROUTER_API_KEY or ANTHROPIC_API_KEY). Run:
 *   node scripts/endpoint.test.mjs
 *   BASE_URL=https://pts-100-article-assessment.vercel.app node scripts/endpoint.test.mjs
 */

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:43127";

// Synthetic antisemitic own-voice fixture (for testing only; never for display).
// Conspiracy trope (AS2), justifying/celebrating harm (AS1) and Holocaust denial
// (AS4) in the publication's own voice.
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

const SAMPLE_ARTICLE = `
CHICAGO — City leaders opened a new two-acre green space in downtown Chicago on Monday morning, providing residents with a free public area featuring native plants, walking paths, and a children's playground.
The project cost $4.2 million and took nearly two years to complete. Funded through a mix of municipal bonds and private donations, the park transforms a former industrial parking lot into a neighborhood hub.
"This space gives families a place to gather and breathe clean air," said Mayor Sarah Jenkins during the ribbon-cutting ceremony. Local business owners also praised the addition, noting it should increase foot traffic in the commercial district.
Construction crews added energy-efficient LED lighting and smart irrigation systems to minimize water waste. The park remains open daily from sunrise to sunset. City officials plan to host a weekend community festival next month to celebrate the opening.
`;

let failures = 0;
function check(cond, msg, ctx) {
  const ok = Boolean(cond);
  console.log(`  ${ok ? "PASS" : "FAIL"} — ${msg}`);
  if (!ok) {
    failures++;
    if (ctx !== undefined) console.log(`       ${JSON.stringify(ctx)}`);
  }
}

async function assess(body, attempts = 2) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(`${BASE_URL}/api/assess`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (res.ok) return data;
    lastErr = data.error || `HTTP ${res.status}`;
  }
  throw new Error(`assess failed: ${lastErr}`);
}

async function main() {
  console.log(`Endpoint test against ${BASE_URL}\n`);

  console.log("BAD_FIXTURE (antisemitic own voice):");
  const bad = await assess({ text: BAD_FIXTURE, designation: "ARTICLE" });
  const bs = bad.score;
  const findingIds = (bs.pts_a?.findings || []).map((f) => f.criterion);
  const reviewIds = (bs.pts_a?.human_review || []).map((h) => h.criterion);
  if (bs.mocked) {
    console.log("  SKIP — mock provider (no model key); cannot assert real scoring.");
  } else {
    check(bs.pts_a.score <= 39, `PTS-A <= 39 (got ${bs.pts_a.score})`, bs.pts_a.score);
    check(bs.pts_a.cap_applied === true, "PTS-A cap_applied === true", bs.pts_a.cap_applied);
    check(
      findingIds.includes("AS1") || findingIds.includes("AS2"),
      "PTS-A findings include a conspiracy/incitement criterion (AS1/AS2)",
      findingIds,
    );
    check(findingIds.includes("AS4"), "PTS-A findings include AS4 (Holocaust denial)", findingIds);
    check(reviewIds.includes("AS4"), "PTS-A human_review contains AS4", reviewIds);
  }

  console.log("\nSAMPLE_ARTICLE (clean Chicago park):");
  const clean = await assess({ text: SAMPLE_ARTICLE, designation: "ARTICLE" });
  const cs = clean.score;
  if (cs.mocked) {
    console.log("  SKIP — mock provider (no model key).");
  } else {
    check(cs.pts_a.score === 100, `PTS-A === 100 (got ${cs.pts_a.score})`, cs.pts_a.score);
    check(cs.pts_j.score === 100, `PTS-J === 100 (got ${cs.pts_j.score})`, cs.pts_j.score);
    check(
      cs.pts_j.possible < 100,
      `PTS-J coverage < 100 points assessable (got ${cs.pts_j.possible})`,
      cs.pts_j.coverage,
    );
  }

  console.log(`\n${failures === 0 ? "All endpoint assertions passed." : `${failures} assertion(s) failed.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Endpoint test error:", e.message);
  process.exit(1);
});
