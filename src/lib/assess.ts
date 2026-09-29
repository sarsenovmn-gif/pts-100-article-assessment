import Anthropic from "@anthropic-ai/sdk";
import {
  ANTHROPIC_VERSION,
  ASSESSMENT_TOOL,
  CRITERION_IDS,
  MAX_RETRIES,
  MAX_TOKENS,
  MODEL,
  OPENROUTER_BASE_URL,
  OPENROUTER_MODEL,
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

export type Provider = "anthropic" | "openrouter" | "mock";

/**
 * Choose the model provider. OpenRouter takes priority when its key is set
 * (opt-in third-party router), then the issued Anthropic key, else mock.
 */
export function getProvider(): Provider {
  if ((process.env.OPENROUTER_API_KEY || "").trim()) return "openrouter";
  if ((process.env.ANTHROPIC_API_KEY || "").trim()) return "anthropic";
  return "mock";
}

function buildUserPrompt(articleText: string, opts: AssessOptions): string {
  const { designation, languageHint } = opts;
  const body = _sanitise_article(articleText);

  const hints: string[] = [];
  if (designation) hints.push(`Designation stated by the caller: ${designation}. Use it.`);
  if (languageHint) hints.push(`Language hint from the caller: ${languageHint}.`);
  const hintBlock = hints.length ? `${hints.join("\n")}\n\n` : "";

  return `Assess the following publication according to the complete PTS-100
framework supplied in the system instructions.

Return one assessment for every criterion A1-C4, an entry for every
Block D clause you considered, and the legal flag.
Do not calculate the final numerical score yourself.

${hintBlock}<ARTICLE>
${body}
</ARTICLE>`;
}

/** Send one publication to the model and return the structured assessment. */
export async function assessArticle(
  articleText: string,
  opts: AssessOptions = {},
): Promise<Assessment> {
  const provider = getProvider();
  if (provider === "openrouter") return assessViaOpenRouter(articleText, opts);
  return assessViaAnthropic(articleText, opts);
}

async function assessViaAnthropic(
  articleText: string,
  opts: AssessOptions,
): Promise<Assessment> {
  const userPrompt = buildUserPrompt(articleText, opts);

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

type OpenRouterResponse = {
  model?: string;
  usage?: Record<string, unknown>;
  choices?: {
    message?: {
      tool_calls?: { function?: { name?: string; arguments?: string } }[];
    };
  }[];
};

/**
 * OpenRouter path: OpenAI-compatible chat completions with forced function
 * calling. The same PTS-100 tool schema is used as the function parameters.
 */
async function assessViaOpenRouter(
  articleText: string,
  opts: AssessOptions,
): Promise<Assessment> {
  const apiKey = (process.env.OPENROUTER_API_KEY || "").trim();
  const userPrompt = buildUserPrompt(articleText, opts);

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
    tool_choice: {
      type: "function",
      function: { name: ASSESSMENT_TOOL.name },
    },
  };

  let lastError = "";
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://pts-100.local",
        "X-Title": "PTS-100 Publication Trust Score",
      },
      body: JSON.stringify(payload),
    });

    if ([429, 500, 502, 503, 529].includes(res.status)) {
      lastError = `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`;
      await new Promise((r) => setTimeout(r, Math.min(2 ** attempt * 1000, 20000)));
      continue;
    }
    if (!res.ok) {
      throw new Error(
        `OpenRouter error HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`,
      );
    }

    const data = (await res.json()) as OpenRouterResponse;
    const call = data.choices?.[0]?.message?.tool_calls?.[0]?.function;
    if (!call?.arguments) {
      throw new Error("OpenRouter returned no structured assessment (no tool call).");
    }
    let assessment: Assessment;
    try {
      assessment = JSON.parse(call.arguments) as Assessment;
    } catch {
      throw new Error("OpenRouter tool arguments were not valid JSON.");
    }
    assessment._provenance = {
      model: data.model || OPENROUTER_MODEL,
      prompt_version: PROMPT_VERSION,
      usage: data.usage ?? {},
    };
    return assessment;
  }

  throw new Error(
    `OpenRouter unavailable after ${MAX_RETRIES} attempts. Last error: ${lastError}`,
  );
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
      "[MOCK] No model key configured, so this is a placeholder all-PASS assessment" +
      (headline ? ` for “${headline}”.` : ".") +
      " Set ANTHROPIC_API_KEY (or OPENROUTER_API_KEY) for a real PTS-100 evaluation.",
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
  const mocked = getProvider() === "mock";
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
