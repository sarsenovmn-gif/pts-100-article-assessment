import Anthropic from "@anthropic-ai/sdk";
import {
  ALLOW_MOCK,
  ANTHROPIC_VERSION,
  ASSESSMENT_TOOL,
  MAX_RETRIES,
  MAX_TOKENS,
  MODEL,
  MODEL_CRITERION_IDS,
  OPENROUTER_BASE_URL,
  OPENROUTER_MODEL,
  PROMPT_VERSION,
  PTS_SYSTEM_PROMPT,
  TEMPERATURE,
} from "./rubric";
import { _provenance, _sanitise_article, calculate_scores } from "./scorer";
import { formatHitsForPrompt, prescan } from "./lexicon";
import { buildPublicationText } from "./extract";
import type {
  ArticleParts,
  Assessment,
  CriterionAssessment,
  Designation,
  LexiconHit,
  Scores,
} from "./types";

export type AssessOptions = {
  designation?: Designation | string | null;
  languageHint?: string | null;
  runId?: string | null;
  lexiconHits?: LexiconHit[];
};

export type Provider = "anthropic" | "openrouter" | "mock";

export class ModelError extends Error {
  stop_reason?: string;
  constructor(message: string, stopReason?: string) {
    super(message);
    this.name = "ModelError";
    this.stop_reason = stopReason;
  }
}

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

export function getProvider(): Provider {
  if ((process.env.OPENROUTER_API_KEY || "").trim()) return "openrouter";
  if ((process.env.ANTHROPIC_API_KEY || "").trim()) return "anthropic";
  return "mock";
}

function sectionsFromParts(parts: ArticleParts): { section: string; text: string }[] {
  const s: { section: string; text: string }[] = [];
  if (parts.headline) s.push({ section: "HEADLINE", text: parts.headline });
  if (parts.standfirst) s.push({ section: "STANDFIRST", text: parts.standfirst });
  if (parts.byline) s.push({ section: "BYLINE", text: parts.byline });
  if (parts.body) s.push({ section: "BODY", text: parts.body });
  return s;
}

function buildUserPrompt(
  articleText: string,
  opts: AssessOptions,
  hitsText: string,
): string {
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

export async function assessArticle(
  articleText: string,
  opts: AssessOptions = {},
): Promise<Assessment> {
  const provider = getProvider();
  const hitsText = formatHitsForPrompt(opts.lexiconHits ?? []);
  if (provider === "openrouter") return assessViaOpenRouter(articleText, opts, hitsText);
  return assessViaAnthropic(articleText, opts, hitsText);
}

async function assessViaAnthropic(
  articleText: string,
  opts: AssessOptions,
  hitsText: string,
): Promise<Assessment> {
  const userPrompt = buildUserPrompt(articleText, opts, hitsText);
  const client = new Anthropic({
    apiKey: (process.env.ANTHROPIC_API_KEY || "").trim(),
    baseURL: process.env.ANTHROPIC_BASE_URL || undefined,
    maxRetries: MAX_RETRIES,
    defaultHeaders: { "anthropic-version": ANTHROPIC_VERSION },
  });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    temperature: TEMPERATURE,
    system: PTS_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
    tools: [ASSESSMENT_TOOL as unknown as Anthropic.Tool],
    tool_choice: { type: "tool", name: ASSESSMENT_TOOL.name },
  });

  console.log(
    `[pts] anthropic model=${response.model} stop_reason=${response.stop_reason} usage=${JSON.stringify(response.usage ?? {})}`,
  );

  if (response.stop_reason === "max_tokens") {
    throw new ModelError("Model output truncated (max_tokens). Increase max_tokens and retry.", "max_tokens");
  }
  for (const block of response.content) {
    if (block.type === "tool_use" && block.name === ASSESSMENT_TOOL.name) {
      const assessment = validateAssessment(block.input, response.stop_reason ?? undefined);
      assessment._provenance = {
        model: response.model || MODEL,
        prompt_version: PROMPT_VERSION,
        stop_reason: response.stop_reason ?? undefined,
        usage: response.usage ?? {},
      };
      return assessment;
    }
  }
  throw new ModelError("Model returned no structured assessment.", response.stop_reason ?? undefined);
}

type OpenRouterResponse = {
  model?: string;
  usage?: Record<string, unknown>;
  choices?: {
    finish_reason?: string;
    message?: { tool_calls?: { function?: { name?: string; arguments?: string } }[] };
  }[];
};

async function assessViaOpenRouter(
  articleText: string,
  opts: AssessOptions,
  hitsText: string,
): Promise<Assessment> {
  const apiKey = (process.env.OPENROUTER_API_KEY || "").trim();
  const userPrompt = buildUserPrompt(articleText, opts, hitsText);

  const payload = {
    model: OPENROUTER_MODEL,
    temperature: TEMPERATURE,
    max_tokens: MAX_TOKENS,
    messages: [
      { role: "system", content: PTS_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: ASSESSMENT_TOOL.name,
          description: ASSESSMENT_TOOL.description,
          parameters: ASSESSMENT_TOOL.input_schema,
        },
      },
    ],
    tool_choice: { type: "function", function: { name: ASSESSMENT_TOOL.name } },
  };

  let lastError = "";
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://pts-100.local",
        "X-Title": "PTS Publication Trust Score",
      },
      body: JSON.stringify(payload),
    });

    if ([429, 500, 502, 503, 529].includes(res.status)) {
      lastError = `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`;
      await new Promise((r) => setTimeout(r, Math.min(2 ** attempt * 1000, 20000)));
      continue;
    }
    if (!res.ok) {
      throw new Error(`OpenRouter error HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
    }

    const data = (await res.json()) as OpenRouterResponse;
    const finishReason = data.choices?.[0]?.finish_reason;
    console.log(
      `[pts] openrouter model=${data.model} finish_reason=${finishReason} usage=${JSON.stringify(data.usage ?? {})}`,
    );
    if (finishReason === "length") {
      throw new ModelError("Model output truncated (length). Increase max_tokens and retry.", "length");
    }
    const call = data.choices?.[0]?.message?.tool_calls?.[0]?.function;
    if (!call?.arguments) {
      throw new ModelError("Model returned no structured assessment (no tool call).", finishReason);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(call.arguments);
    } catch {
      throw new ModelError(
        "Model tool arguments were not valid JSON" + (finishReason === "length" ? " (output truncated)." : "."),
        finishReason,
      );
    }
    const assessment = validateAssessment(parsed, finishReason);
    assessment._provenance = {
      model: data.model || OPENROUTER_MODEL,
      prompt_version: PROMPT_VERSION,
      stop_reason: finishReason,
      usage: data.usage ?? {},
    };
    return assessment;
  }
  throw new Error(`OpenRouter unavailable after ${MAX_RETRIES} attempts. Last error: ${lastError}`);
}

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
    _provenance: { model: "mock", prompt_version: PROMPT_VERSION },
  };
}

/** Score returned when no real provider is available and mock is not allowed. */
function unavailableScores(
  articleText: string,
  designation?: Designation | string | null,
): Scores {
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

export async function scorePublication(
  articleText: string,
  opts: AssessOptions = {},
): Promise<{ assessment: Assessment | null; score: Scores; mocked: boolean; unavailable: boolean }> {
  const provider = getProvider();

  if (provider === "mock" && !ALLOW_MOCK) {
    return { assessment: null, score: unavailableScores(articleText, opts.designation), mocked: false, unavailable: true };
  }

  const sections = [{ section: "BODY", text: articleText }];
  const hits = prescan(sections, opts.languageHint);
  const mocked = provider === "mock";
  const assessment = mocked ? mockAssessment(articleText) : await assessArticle(articleText, { ...opts, lexiconHits: hits });
  const score = calculate_scores(assessment, articleText, {
    designation: opts.designation ?? undefined,
    runId: opts.runId ?? undefined,
    lexiconHits: hits,
  });
  if (mocked) score.mocked = true;
  return { assessment, score, mocked, unavailable: false };
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

  const sections = sectionsFromParts(parts);
  const hits = prescan(sections, opts.languageHint);
  const mocked = provider === "mock";
  const assessment = mocked ? mockAssessment(parts) : await assessArticle(text, { ...opts, designation, lexiconHits: hits });
  const score = calculate_scores(assessment, text, {
    designation,
    runId: opts.runId ?? undefined,
    lexiconHits: hits,
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
  return { parts: { ...parts, mocked }, assessment, score };
}
