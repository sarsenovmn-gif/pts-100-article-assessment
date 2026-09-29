import { NextRequest, NextResponse } from "next/server";
import { assessArticle } from "@/lib/assess";
import { extractFromUrl, fromRawText } from "@/lib/extract";
import type { ArticleMeta } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let payload: { url?: string; text?: string; title?: string };
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

  try {
    let article: ArticleMeta;
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
        article = await extractFromUrl(url);
      } catch (e) {
        return NextResponse.json(
          { error: e instanceof Error ? e.message : "Failed to fetch URL." },
          { status: 422 },
        );
      }
    } else {
      article = fromRawText(text!, payload.title);
    }

    if (article.wordCount < 20) {
      return NextResponse.json(
        { error: "Article is too short to assess (need at least 20 words)." },
        { status: 422 },
      );
    }

    const assessment = await assessArticle(article);
    return NextResponse.json(assessment);
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? e.message
            : "Assessment failed. Check the server logs.",
      },
      { status: 500 },
    );
  }
}
