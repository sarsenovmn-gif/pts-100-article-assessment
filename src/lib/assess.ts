import {
  ALLOW_MOCK,
  ASSESSMENT_TOOL,
  MODEL,
  MODEL_CRITERION_IDS,
  PROMPT_VERSION,
  PTS_SYSTEM_PROMPT,
  TWO_PASS,
} from "./rubric";
import { _provenance, _sanitise_article, calculate_scores } from "./scorer";
import { callTool, getProvider, ModelError } from "./provider";
import { assessTwoPass } from "./twopass";
import { formatHitsForPrompt, prescan } from "./lexicon";
import { detectInjection } from "./normalise";
import { buildPublicationText } from "./extract";
import type {
  ArticleParts,
  Assessment,
  AuditData,
  CriterionAssessment,
  Designation,
  LexiconHit,
  Provenance,
  Scores,
} from "./types";

export { ModelError, getProvider };
export type { Provider } from "./provider";

export type AssessOptions = {
  designation?: Designation | string | null;
  languageHint?: string | null;
  runId?: string | null;
  lexiconHits?: LexiconHit[];
  /** Wall-clock start (Date.now()) of the request, for the two-pass time budget. */
  startTime?: number;
  /** Total time budget in ms for the two-pass path. */
  timeBudgetMs?: number;
};

function validateAssessment(assessment: unknown, stopReason?: string): Assessment {
  const a = assessment as Partial<Assessment> | null | undefined;
  if (!a || typeof a !== "object") {
    throw new ModelError("Model returned no structured assessment.", stopReason);
  }
  if (!Array.isArray(a.criteria) || a.criteria.length === 0) {
    throw new ModelError(
      "Model returned an incomplete assessment (no criteria). " +
        (stopReason === "max_tokens" || stopReason === "length"
          ? "Output was truncated; increase max_tokens."
          : "Retry, or enable debug to inspect the raw model output."),
      stopReason,
    );
  }
  return a as Assessment;
}

function sectionsFromParts(parts: ArticleParts): { section: string; text: string }[] {
  const s: { section: string; text: string }[] = [];
  if (parts.headline) s.push({ section: "HEADLINE", text: parts.headline });
  if (parts.standfirst) s.push({ section: "STANDFIRST", text: parts.standfirst });
  if (parts.byline) s.push({ section: "BYLINE", text: parts.byline });
  if (parts.body) s.push({ section: "BODY", text: parts.body });
  return s;
}

// ============================================================
// Single-pass path (fallback when PTS_TWO_PASS=0)
// ============================================================

function buildUserPrompt(articleText: string, opts: AssessOptions, hitsText: string): string {
  const { designation, languageHint } = opts;
  const body = _sanitise_article(articleText);
  const hints: string[] = [];
  if (designation) hints.push(`Designation stated by the caller: ${designation}. Use it.`);
  if (languageHint) hints.push(`Language hint from the caller: ${languageHint}.`);
  const hintBlock = hints.length ? `${hints.join("\n")}\n\n` : "";

  return `Assess the following publication under the strict two-score (PTS-A + PTS-J)
framework in the system instructions. Never compute the numerical scores.

Workflow:
1. Populate candidate_passages with every passage (verbatim) mentioning Jews,
   Judaism, Israel, Zionism, the Holocaust or antisemitism (empty array if none).
2. Return EXACTLY one criteria object for each of: ${MODEL_CRITERION_IDS.join(", ")}.
   Use a graded severity (PASS/MINOR/MODERATE/MAJOR/SEVERE/UNRESOLVED/NOT_APPLICABLE);
   a PASS rationale must state what was checked. AS1-AS6 are always applicable: if
   the piece has no Jewish/Israel/antisemitism content, that is a PASS (you checked
   and found none), NOT NOT_APPLICABLE. Reserve NOT_APPLICABLE for criteria that
   structurally cannot apply (e.g. J8/J9/J7/J10/J3 with no commercial/financial/
   ownership/corrections dimension). Do not turn genuine uncertainty into a PASS.
3. Adjudicate every lexicon hit below in lexicon_adjudications[].
4. Run the Sharansky 3D test for any Israel/Zionism discourse in three_d[].
5. Extract material factual claims into claims[], copying source names EXACTLY.
   Do NOT classify whether any organisation is designated — software does that.
6. Quote exactly from the section text; give section and offsets where you can.

${hintBlock}${hitsText}

<ARTICLE>
${body}
</ARTICLE>`;
}

export async function assessArticle(articleText: string, opts: AssessOptions = {}): Promise<Assessment> {
  const hitsText = formatHitsForPrompt(opts.lexiconHits ?? []);
  const res = await callTool({
    system: PTS_SYSTEM_PROMPT,
    user: buildUserPrompt(articleText, opts, hitsText),
    tool: ASSESSMENT_TOOL,
    model: MODEL,
  });
  const assessment = validateAssessment(res.input, res.meta.stop_reason);
  assessment._provenance = {
    model: res.meta.model || MODEL,
    prompt_version: PROMPT_VERSION,
    stop_reason: res.meta.stop_reason,
    usage: res.meta.usage ?? {},
    architecture: "single-pass",
  };
  return assessment;
}

// ============================================================
// Mock (dev/test only)
// ============================================================

const MOCK_NOT_APPLICABLE = new Set(["J3", "J7", "J8", "J9", "J10", "J11"]);

/**
 * Deterministic mock — DEV/TEST ONLY. Never used for a production result unless
 * PTS_ALLOW_MOCK=1. Severity-based all-PASS with disclosure criteria NA.
 */
export function mockAssessment(input?: string | ArticleParts): Assessment {
  const criteria: CriterionAssessment[] = MODEL_CRITERION_IDS.map((id) => ({
    id,
    severity: MOCK_NOT_APPLICABLE.has(id) ? "NOT_APPLICABLE" : "PASS",
    evidence_quote: "",
    rationale: MOCK_NOT_APPLICABLE.has(id)
      ? "No publisher metadata in the supplied sample to assess this criterion."
      : "Actively checked; no material concern identified.",
    ihra_examples: [],
    confidence: 0.9,
    human_review_required: false,
    failure_stance: "NONE",
  }));
  const headline = typeof input === "object" && input?.headline ? input.headline : undefined;
  return {
    summary:
      "[MOCK] Development placeholder all-PASS assessment" +
      (headline ? ` for “${headline}”.` : ".") +
      " Set a real model key for a production PTS assessment.",
    language: "en",
    designation: "ARTICLE",
    overall_stance: "REPORTED_CONTEXTUALISED",
    candidate_passages: [],
    criteria,
    three_d: [],
    lexicon_adjudications: [],
    claims: [],
    conduct: [],
    legal_flag: { possible_illegal: false, category: "NONE", evidence_quote: "", rationale: "" },
    _provenance: { model: "mock", prompt_version: PROMPT_VERSION, architecture: "single-pass" },
  };
}

/** Score returned when no real provider is available and mock is not allowed. */
function unavailableScores(articleText: string, designation?: Designation | string | null): Scores {
  const desig = ((designation || "ARTICLE").toString().toUpperCase() as Designation) || "ARTICLE";
  const empty = {
    score: null, displayed_score: null, tier: "Analysis unavailable",
    raw_before_cap: null, cap_applied: false, cap_reason: null,
    earned: 0, possible: 0, applicable: 0, coverage_pct: 0,
    coverage: "not analysed", confidence: "LOW" as const, confidence_value: 0,
    unresolved_count: 0, inconclusive: true,
    inconclusive_reason: "No model provider configured.",
    findings: [], rejected_findings: [], unresolved: [], not_applicable: [], human_review: [],
  };
  const prov = _provenance(mockAssessment(), articleText, desig);
  return {
    pts_a: { ...empty },
    pts_j: { ...empty, conduct_breaches: [] },
    headline_score: null,
    designation: desig,
    analysis_unavailable: true,
    note: "ANALYSIS_UNAVAILABLE — no real model provider is configured, so no PTS result can be produced. (The mock provider is disabled in production; set PTS_ALLOW_MOCK=1 only for local development.)",
    provenance: prov,
  };
}

// ============================================================
// Orchestration
// ============================================================

type AssessArtifacts = {
  assessment: Assessment;
  audit?: AuditData;
  consistency?: number | null;
  consistencyNote?: string;
  provenanceExtra?: Partial<Provenance>;
};

async function produceAssessment(
  parts: ArticleParts,
  text: string,
  opts: AssessOptions,
  hits: LexiconHit[],
  mocked: boolean,
): Promise<AssessArtifacts> {
  if (mocked) return { assessment: mockAssessment(parts) };
  if (TWO_PASS) {
    const r = await assessTwoPass(
      parts,
      text,
      {
        designation: opts.designation ?? parts.designationHint ?? undefined,
        languageHint: opts.languageHint,
        startTime: opts.startTime,
        timeBudgetMs: opts.timeBudgetMs,
      },
      hits,
    );
    return {
      assessment: r.assessment,
      audit: r.audit,
      consistency: r.consistency,
      consistencyNote: r.consistencyNote,
      provenanceExtra: r.provenanceExtra,
    };
  }
  const assessment = await assessArticle(text, {
    ...opts,
    designation: opts.designation ?? parts.designationHint ?? undefined,
    lexiconHits: hits,
  });
  return { assessment };
}

export async function scorePublication(
  articleText: string,
  opts: AssessOptions = {},
): Promise<{ assessment: Assessment | null; score: Scores; mocked: boolean; unavailable: boolean }> {
  const provider = getProvider();
  if (provider === "mock" && !ALLOW_MOCK) {
    return { assessment: null, score: unavailableScores(articleText, opts.designation), mocked: false, unavailable: true };
  }

  const parts: ArticleParts = {
    url: null, source: null, headline: "", standfirst: null, byline: null, published: null,
    body: articleText, extractor: "raw", bodyChars: articleText.length, warning: null,
  };
  const injection = detectInjection(articleText);
  const hits = prescan([{ section: "BODY", text: articleText }], opts.languageHint);
  const mocked = provider === "mock";
  const art = await produceAssessment(parts, articleText, opts, hits, mocked);

  const score = calculate_scores(art.assessment, articleText, {
    designation: opts.designation ?? undefined,
    runId: opts.runId ?? undefined,
    lexiconHits: hits,
    injection,
    consistency: art.consistency,
    consistencyNote: art.consistencyNote,
    audit: art.audit,
    provenanceExtra: art.provenanceExtra,
  });
  if (mocked) score.mocked = true;
  return { assessment: art.assessment, score, mocked, unavailable: false };
}

export async function scoreFromParts(
  parts: ArticleParts,
  opts: AssessOptions = {},
): Promise<{ parts: ArticleParts; assessment: Assessment | null; score: Scores }> {
  const provider = getProvider();
  const text = buildPublicationText(parts);
  const designation = opts.designation ?? parts.designationHint ?? undefined;

  if (provider === "mock" && !ALLOW_MOCK) {
    const score = unavailableScores(text, designation);
    return { parts: { ...parts, mocked: false }, assessment: null, score };
  }

  const injection = detectInjection(text);
  const sections = sectionsFromParts(parts);
  const hits = prescan(sections, opts.languageHint);
  const mocked = provider === "mock";
  const art = await produceAssessment(parts, text, opts, hits, mocked);

  const score = calculate_scores(art.assessment, text, {
    designation,
    runId: opts.runId ?? undefined,
    lexiconHits: hits,
    injection,
    consistency: art.consistency,
    consistencyNote: art.consistencyNote,
    audit: art.audit,
    provenanceExtra: art.provenanceExtra,
  });
  if (mocked) score.mocked = true;

  score.source = {
    url: parts.url,
    source: parts.source,
    headline: parts.headline,
    byline: parts.byline,
    published: parts.published,
    extractor: parts.extractor,
    warning: parts.warning,
    body_chars: parts.bodyChars,
  };
  return { parts: { ...parts, mocked }, assessment: art.assessment, score };
}
