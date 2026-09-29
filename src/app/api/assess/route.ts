import { NextRequest, NextResponse } from "next/server";
import { extractFromUrl, fromRawText } from "@/lib/extract";
import { scoreFromParts } from "@/lib/assess";
import { MIN_BODY_CHARS } from "@/lib/rubric";
import type { ArticleParts, Designation } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const DESIGNATIONS: Designation[] = ["ARTICLE", "POST", "DOCUMENTARY", "SATIRE"];

type Body = {
  url?: string;
  text?: string;
  title?: string;
  designation?: string;
  language?: string;
};

export async function POST(req: NextRequest) {
  let payload: Body;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const url = payload.url?.trim();
  const text = payload.text?.trim();

  if (!url && !text) {
    return NextResponse.json(
      { error: "Provide either a URL or article text." },
      { status: 400 },
    );
  }

  let designation: Designation | undefined;
  if (payload.designation && payload.designation !== "auto") {
    const d = payload.designation.toUpperCase();
    if (!DESIGNATIONS.includes(d as Designation)) {
      return NextResponse.json(
        { error: `Unknown designation: ${payload.designation}` },
        { status: 400 },
      );
    }
    designation = d as Designation;
  }

  const language = payload.language?.trim() || undefined;

  try {
    let parts: ArticleParts;

    if (url) {
      try {
        new URL(url);
      } catch {
        return NextResponse.json(
          { error: "That is not a valid URL." },
          { status: 400 },
        );
      }
      try {
        parts = await extractFromUrl(url);
      } catch (e) {
        return NextResponse.json(
          { error: e instanceof Error ? e.message : "Failed to fetch URL." },
          { status: 422 },
        );
      }
    } else {
      parts = fromRawText(text!, {
        headline: payload.title,
        language,
      });
    }

    if (parts.body.trim().length < MIN_BODY_CHARS) {
      return NextResponse.json(
        {
          error:
            `Publication text is too short to assess (under ${MIN_BODY_CHARS} characters). ` +
            (url
              ? "This usually means a paywall, cookie/consent wall or a social-media page was fetched instead of the article. Paste the full text directly."
              : "Paste the full publication text."),
        },
        { status: 422 },
      );
    }

    const result = await scoreFromParts(parts, {
      designation,
      languageHint: language,
    });

    const debug =
      req.nextUrl.searchParams.get("debug") === "1" ||
      process.env.PTS_DEBUG === "1";

    if (debug) {
      return NextResponse.json({
        ...result,
        debug: {
          provider:
            process.env.OPENROUTER_API_KEY
              ? "openrouter"
              : process.env.ANTHROPIC_API_KEY
                ? "anthropic"
                : "mock",
          stop_reason: result.score.provenance?.stop_reason,
          usage: result.score.provenance?.usage,
          raw_assessment: result.assessment,
        },
      });
    }

    return NextResponse.json(result);
  } catch (e) {
    const stopReason = (e as { stop_reason?: string })?.stop_reason;
    const isModelError = e instanceof Error && e.name === "ModelError";
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? e.message
            : "Assessment failed. Check the server logs.",
        ...(stopReason ? { stop_reason: stopReason } : {}),
      },
      { status: isModelError ? 502 : 500 },
    );
  }
}
