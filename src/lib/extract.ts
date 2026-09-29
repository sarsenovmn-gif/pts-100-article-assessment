import { extract } from "@extractus/article-extractor";
import type { ArticleMeta } from "./types";

function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

/** Extract an article from a live URL using @extractus/article-extractor. */
export async function extractFromUrl(url: string): Promise<ArticleMeta> {
  let parsed: Awaited<ReturnType<typeof extract>> = null;
  try {
    parsed = await extract(url);
  } catch {
    parsed = null;
  }

  if (!parsed || !parsed.content) {
    throw new Error(
      "Could not extract readable content from that URL. Some sites block automated fetches — paste the article text instead.",
    );
  }

  const body = stripHtml(parsed.content);
  let source: string | null = null;
  try {
    source = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    source = parsed.source ?? null;
  }

  return {
    url,
    title: parsed.title?.trim() || "(untitled)",
    standfirst: parsed.description?.trim() || null,
    byline: parsed.author?.trim() || null,
    published: parsed.published?.trim() || null,
    source,
    body,
    wordCount: countWords(body),
  };
}

/** Build article metadata from raw pasted text. */
export function fromRawText(text: string, title?: string): ArticleMeta {
  const body = text.trim();
  return {
    url: null,
    title: title?.trim() || body.split("\n")[0]?.slice(0, 120) || "(pasted text)",
    standfirst: null,
    byline: null,
    published: null,
    source: "pasted text",
    body,
    wordCount: countWords(body),
  };
}
