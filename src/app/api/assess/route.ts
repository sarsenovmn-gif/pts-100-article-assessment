import { NextRequest, NextResponse } from "next/server";
import { extractFromUrl, fromRawText } from "@/lib/extract";
import { scoreFromParts } from "@/lib/assess";
import { getProvider, ProviderAuthError } from "@/lib/provider";
import { ALLOW_MOCK, MIN_BODY_CHARS } from "@/lib/rubric";
import type { ArticleParts, Designation } from "@/lib/types";

export const runtime = "nodejs";
// Requires a paid Vercel plan with Fluid compute. Keep the app's own time budget a
// safe margin under this so we return a JSON 504 before the platform kills us.
export const maxDuration = 300;

/** App-level time budget: return a JSON timeout before the platform's hard limit. */
const ASSESS_TIMEOUT_MS = (maxDuration - 20) * 1000;

const DESIGNATIONS: Designation[] = [
  "ARTICLE",
  "OPINION",
  "POST",
  "DOCUMENTARY",
  "SATIRE",
];

type Body = {
  url?: string;
  text?: string;
  title?: string;
  designation?: string;
  language?: string;
};

type ErrorCode =
  | "BAD_REQUEST"
  | "MISSING_ENV"
  | "EXTRACT_FAILED"
  | "TEXT_TOO_SHORT"
  | "ANALYSIS_UNAVAILABLE"
  | "PROVIDER_AUTH"
  | "MODEL_ERROR"
  | "TIMEOUT"
  | "INTERNAL_ERROR";

type Stage = "config" | "extract" | "assess";

function errorJson(
  status: number,
  code: ErrorCode,
  error: string,
  extra?: { stage?: Stage; elapsed_ms?: number; detail?: string; stop_reason?: string },
) {
  return NextResponse.json({ error, code, ...extra }, { status });
}

async function handle(req: NextRequest): Promise<NextResponse> {
  const start = Date.now();

  let payload: Body;
  try {
    payload = await req.json();
  } catch {
    return errorJson(400, "BAD_REQUEST", "Invalid JSON body.");
  }

  const url = payload.url?.trim();
  const text = payload.text?.trim();

  if (!url && !text) {
    return errorJson(400, "BAD_REQUEST", "Provide either a URL or article text.");
  }

  let designation: Designation | undefined;
  if (payload.designation && payload.designation !== "auto") {
    const d = payload.designation.toUpperCase();
    if (!DESIGNATIONS.includes(d as Designation)) {
      return errorJson(400, "BAD_REQUEST", `Unknown designation: ${payload.designation}`);
    }
    designation = d as Designation;
  }

  const language = payload.language?.trim() || undefined;

  // Config check BEFORE doing any work: no real provider and no mock allowed → fail
  // fast with a clear, machine-readable code instead of a late 503.
  if (getProvider() === "mock" && !ALLOW_MOCK) {
    console.error(`[pts] stage=config missing provider env (${Date.now() - start}ms)`);
    return errorJson(500, "MISSING_ENV", "Set ANTHROPIC_API_KEY or OPENROUTER_API_KEY", {
      stage: "config",
      elapsed_ms: Date.now() - start,
    });
  }

  // ---- Extract ----
  let parts: ArticleParts;
  if (url) {
    try {
      new URL(url);
    } catch {
      return errorJson(400, "BAD_REQUEST", "That is not a valid URL.");
    }
    try {
      parts = await extractFromUrl(url);
    } catch (e) {
      console.error(`[pts] stage=extract failed (${Date.now() - start}ms):`, e);
      return errorJson(422, "EXTRACT_FAILED", e instanceof Error ? e.message : "Failed to fetch URL.", {
        stage: "extract",
        elapsed_ms: Date.now() - start,
      });
    }
  } else {
    parts = fromRawText(text!, { headline: payload.title, language });
  }

  if (parts.body.trim().length < MIN_BODY_CHARS) {
    return errorJson(
      422,
      "TEXT_TOO_SHORT",
      `Publication text is too short to assess (under ${MIN_BODY_CHARS} characters). ` +
        (url
          ? "This usually means a paywall, cookie/consent wall or a social-media page was fetched instead of the article. Paste the full text directly."
          : "Paste the full publication text."),
      { stage: "extract", elapsed_ms: Date.now() - start },
    );
  }

  // ---- Assess (with a hard time budget) ----
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ASSESS_TIMEOUT_MS);
  let result: Awaited<ReturnType<typeof scoreFromParts>>;
  try {
    result = await scoreFromParts(parts, {
      designation,
      languageHint: language,
      signal: controller.signal,
    });
  } catch (e) {
    const elapsed_ms = Date.now() - start;
    if (controller.signal.aborted) {
      console.error(`[pts] stage=assess timeout after ${elapsed_ms}ms`);
      return errorJson(504, "TIMEOUT", `Assessment exceeded the ${ASSESS_TIMEOUT_MS / 1000}s time budget.`, {
        stage: "assess",
        elapsed_ms,
      });
    }
    if (e instanceof ProviderAuthError) {
      console.error(`[pts] stage=assess provider auth (${elapsed_ms}ms):`, e.message);
      return errorJson(502, "PROVIDER_AUTH", e.message, { stage: "assess", elapsed_ms });
    }
    if (e instanceof Error && e.name === "ModelError") {
      console.error(`[pts] stage=assess model error (${elapsed_ms}ms):`, e.message);
      return errorJson(502, "MODEL_ERROR", e.message, {
        stage: "assess",
        elapsed_ms,
        stop_reason: (e as { stop_reason?: string }).stop_reason,
      });
    }
    // Anything else bubbles to the POST wrapper as INTERNAL_ERROR.
    throw e;
  } finally {
    clearTimeout(timer);
  }

  // Production safety: no real provider → no PTS result (never 100/100).
  if (result.score.analysis_unavailable) {
    return errorJson(503, "ANALYSIS_UNAVAILABLE", "No model provider is configured, so no PTS result can be produced.", {
      stage: "assess",
      elapsed_ms: Date.now() - start,
      detail: result.score.note || undefined,
    });
  }

  console.log(`[pts] stage=assess ok in ${Date.now() - start}ms`);

  const debug =
    req.nextUrl?.searchParams.get("debug") === "1" || process.env.PTS_DEBUG === "1";

  if (debug) {
    return NextResponse.json({
      ...result,
      debug: {
        provider: getProvider(),
        elapsed_ms: Date.now() - start,
        stop_reason: result.score.provenance?.stop_reason,
        usage: result.score.provenance?.usage,
        lexicon_hits: result.score.lexicon_hits,
        org_resolutions: result.score.org_resolutions,
        raw_assessment: result.assessment,
      },
    });
  }

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  try {
    return await handle(req);
  } catch (e) {
    console.error("[pts] stage=assess unhandled exception:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Assessment failed. Check the server logs.", code: "INTERNAL_ERROR" },
      { status: 500 },
    );
  }
}
