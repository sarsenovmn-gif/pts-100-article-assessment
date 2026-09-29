import Anthropic from "@anthropic-ai/sdk";
import { CRITERIA, bandFor } from "./rubric";
import type { ArticleMeta, Assessment, CriterionResult } from "./types";

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "claude-3-5-haiku-latest";

function buildPrompt(article: ArticleMeta): string {
  const criteriaBlock = CRITERIA.map(
    (c) => `- ${c.id} (${c.name}): ${c.description}\n  Guidance: ${c.guidance}`,
  ).join("\n");

  return [
    "You are a rigorous editorial assessor running the PTS-100 pipeline.",
    "Assess the article below against each labelled criterion.",
    "",
    "Rules:",
    "- Score each criterion 0-100, OR mark it NOT_ASSESSABLE if the article lacks",
    "  the material needed to judge it. Do not guess.",
    "- Every point you make MUST be backed by a short verbatim quote copied",
    "  exactly from the BODY. Never invent quotes. If you cannot find supporting",
    "  text, do not make the claim.",
    "- The overall score is the mean of the assessable criteria, rescaled to 100.",
    "",
    "Criteria:",
    criteriaBlock,
    "",
    "Return ONLY valid JSON matching this shape (no markdown, no prose):",
    "{",
    '  "summary": string,',
    '  "criteria": [',
    '    { "id": "C1", "assessable": boolean, "score": number|null,',
    '      "rationale": string, "evidence": [string, ...] }',
    "  ]",
    "}",
    "",
    "=== ARTICLE ===",
    `HEADLINE: ${article.title}`,
    `STANDFIRST: ${article.standfirst ?? "(none)"}`,
    `BYLINE: ${article.byline ?? "(none)"}`,
    `PUBLISHED: ${article.published ?? "(none)"}`,
    `SOURCE: ${article.source ?? "(none)"}`,
    "BODY:",
    article.body.slice(0, 24000),
  ].join("\n");
}

type ModelCriterion = {
  id: string;
  assessable: boolean;
  score: number | null;
  rationale: string;
  evidence: string[];
};

function extractJson(text: string): { summary: string; criteria: ModelCriterion[] } {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Model did not return JSON.");
  return JSON.parse(text.slice(start, end + 1));
}

function assemble(
  article: ArticleMeta,
  summary: string,
  modelCriteria: ModelCriterion[],
  model: string,
  mocked: boolean,
): Assessment {
  const criteria: CriterionResult[] = CRITERIA.map((c) => {
    const m = modelCriteria.find((x) => x.id === c.id);
    const assessable = m?.assessable ?? false;
    const rawScore = m?.score;
    const score =
      assessable && typeof rawScore === "number"
        ? Math.max(0, Math.min(100, Math.round(rawScore)))
        : null;
    return {
      id: c.id,
      name: c.name,
      description: c.description,
      assessable,
      score,
      rationale: m?.rationale?.trim() || "No rationale provided.",
      evidence: Array.isArray(m?.evidence) ? m!.evidence.slice(0, 5) : [],
    };
  });

  const scored = criteria.filter((c) => c.assessable && c.score !== null);
  const overallScore = scored.length
    ? Math.round(scored.reduce((s, c) => s + (c.score ?? 0), 0) / scored.length)
    : 0;

  return {
    overallScore,
    band: bandFor(overallScore),
    summary: summary.trim() || "No summary provided.",
    criteria,
    article,
    model,
    mocked,
  };
}

/** Deterministic mock so the app is usable without an API key. */
export function mockAssessment(article: ArticleMeta): Assessment {
  const seed = article.wordCount;
  const modelCriteria: ModelCriterion[] = CRITERIA.map((c, i) => {
    const assessable = !(c.id === "C2" && article.wordCount < 120);
    return {
      id: c.id,
      assessable,
      score: assessable ? 55 + ((seed + i * 13) % 35) : null,
      rationale: assessable
        ? `[MOCK] Heuristic assessment for ${c.name} based on ${article.wordCount} words. Set ANTHROPIC_API_KEY for a real evaluation.`
        : "[MOCK] Not enough material in the article to assess this criterion.",
      evidence: assessable
        ? [article.body.split(/(?<=[.!?])\s/)[i]?.trim() || article.title]
        : [],
    };
  });
  return assemble(
    article,
    "[MOCK] Sample assessment generated without a language model. Add ANTHROPIC_API_KEY to enable real PTS-100 scoring.",
    modelCriteria,
    "mock",
    true,
  );
}

export async function assessArticle(article: ArticleMeta): Promise<Assessment> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return mockAssessment(article);

  const client = new Anthropic({
    apiKey,
    baseURL: process.env.ANTHROPIC_BASE_URL || undefined,
  });

  const message = await client.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 2000,
    messages: [{ role: "user", content: buildPrompt(article) }],
  });

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const parsed = extractJson(text);
  return assemble(article, parsed.summary, parsed.criteria, DEFAULT_MODEL, false);
}
