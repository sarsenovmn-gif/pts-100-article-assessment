import Anthropic from "@anthropic-ai/sdk";
import {
  ANTHROPIC_VERSION,
  ASSESSMENT_TOOL,
  CRITERION_IDS,
  MAX_RETRIES,
  MAX_TOKENS,
  MODEL,
  PROMPT_VERSION,
  PTS_SYSTEM_PROMPT,
  TEMPERATURE,
} from "./rubric";
import { _sanitise_article, calculate_pts100 } from "./scorer";
import { buildPublicationText } from "./extract";
import type {
  ArticleParts,
  Assessment,
  CriterionAssessment,
  Designation,
  ScoreResult,
} from "./types";

export type AssessOptions = {
  designation?: Designation | string | null;
  languageHint?: string | null;
  runId?: string | null;
};

function hasApiKey(): boolean {
  return Boolean((process.env.ANTHROPIC_API_KEY || "").trim());
}

/** Send one publication to the model and return the structured assessment. */
export async function assessArticle(
  articleText: string,
  opts: AssessOptions = {},
): Promise<Assessment> {
  const { designation, languageHint } = opts;
  const body = _sanitise_article(articleText);

  const hints: string[] = [];
  if (designation) hints.push(`Designation stated by the caller: ${designation}. Use it.`);
  if (languageHint) hints.push(`Language hint from the caller: ${languageHint}.`);
  const hintBlock = hints.length ? `${hints.join("\n")}\n\n` : "";

  const userPrompt = `Assess the following publication according to the complete PTS-100
framework supplied in the system instructions.

Return one assessment for every criterion A1-C4, an entry for every
Block D clause you considered, and the legal flag.
Do not calculate the final numerical score yourself.

${hintBlock}<ARTICLE>
${body}
</ARTICLE>`;

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

  if (response.stop_reason === "max_tokens") {
    throw new Error("Model output was cut off (max_tokens). Increase MAX_TOKENS.");
  }

  for (const block of response.content) {
    if (block.type === "tool_use" && block.name === ASSESSMENT_TOOL.name) {
      const assessment = block.input as Assessment;
      assessment._provenance = {
        model: response.model || MODEL,
        prompt_version: PROMPT_VERSION,
        usage: response.usage ?? {},
      };
      return assessment;
    }
  }

  throw new Error("Model returned no structured assessment.");
}

/**
 * Deterministic mock so the app is usable without an API key. Mirrors the
 * reference `_mock_assessment`: all-PASS with B4/C2/C3 NOT_ASSESSABLE.
 */
export function mockAssessment(input?: string | ArticleParts): Assessment {
  const criteria: CriterionAssessment[] = CRITERION_IDS.map((id) => ({
    id,
    status: (["B4", "C2", "C3"] as string[]).includes(id)
      ? "NOT_ASSESSABLE"
      : "PASS",
    evidence_quote: "",
    rationale:
      id === "B4" || id === "C2" || id === "C3"
        ? "Not enough information in the supplied text to assess this criterion."
        : "ok",
    ihra_examples: [],
    confidence: 0.9,
    human_review_required: false,
    failure_stance: "NONE",
  }));

  const headline =
    typeof input === "object" && input?.headline ? input.headline : undefined;

  return {
    summary:
      "[MOCK] No ANTHROPIC_API_KEY configured, so this is a placeholder all-PASS assessment" +
      (headline ? ` for “${headline}”.` : ".") +
      " Set ANTHROPIC_API_KEY for a real PTS-100 evaluation.",
    language: "en",
    designation: "ARTICLE",
    overall_stance: "OWN_VOICE",
    criteria,
    conduct: [],
    legal_flag: {
      possible_illegal: false,
      category: "NONE",
      evidence_quote: "",
      rationale: "",
    },
    _provenance: { model: "mock", prompt_version: PROMPT_VERSION },
  };
}

/** One call: model (or mock) assessment + deterministic scoring. */
export async function scorePublication(
  articleText: string,
  opts: AssessOptions = {},
): Promise<{ assessment: Assessment; score: ScoreResult; mocked: boolean }> {
  const mocked = !hasApiKey();
  const assessment = mocked
    ? mockAssessment(articleText)
    : await assessArticle(articleText, opts);
  const score = calculate_pts100(
    assessment,
    articleText,
    opts.designation ?? undefined,
    opts.runId ?? undefined,
  );
  if (mocked) score.mocked = true;
  return { assessment, score, mocked };
}

/** Combine labelled parts -> publication text -> assess + score. */
export async function scoreFromParts(
  parts: ArticleParts,
  opts: AssessOptions = {},
): Promise<{ parts: ArticleParts; assessment: Assessment; score: ScoreResult }> {
  const text = buildPublicationText(parts);
  const { assessment, score, mocked } = await scorePublication(text, opts);

  const partsOut: ArticleParts = { ...parts, mocked };
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
  return { parts: partsOut, assessment, score };
}
