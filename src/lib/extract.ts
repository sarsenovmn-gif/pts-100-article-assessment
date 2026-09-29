import { extract } from "@extractus/article-extractor";
import type { ArticleParts } from "./types";

const MIN_BODY_CHARS = 300;

function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|section|article|li|h[1-6]|br)>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .trim();
}

/** Extract a publication from a live URL using @extractus/article-extractor. */
export async function extractFromUrl(url: string): Promise<ArticleParts> {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("Not a URL. Paste a link starting with http:// or https://");
  }

  let parsed: Awaited<ReturnType<typeof extract>> = null;
  try {
    parsed = await extract(url);
  } catch {
    parsed = null;
  }

  const extractor = parsed && parsed.content ? "trafilatura" : "fallback";
  const body = stripHtml(parsed?.content);

  if (!parsed || !body) {
    throw new Error(
      "Could not extract readable content from that URL. Some sites block automated fetches or require login — paste the article text instead.",
    );
  }

  let source: string | null = null;
  try {
    source = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    source = parsed.source ?? null;
  }

  let warning: string | null = null;
  if (body.length < MIN_BODY_CHARS) {
    warning =
      "Extracted body is very short (paywall, login wall or a social-media page?). Paste the text instead.";
  }

  return {
    url: parsed.url ?? url,
    source,
    headline: parsed.title?.trim() || "",
    standfirst: parsed.description?.trim() || null,
    byline: parsed.author?.trim() || null,
    published: parsed.published?.trim() || null,
    body,
    extractor,
    bodyChars: body.length,
    warning,
  };
}

/** Build article parts from raw pasted text. */
export function fromRawText(
  text: string,
  opts?: { headline?: string; language?: string },
): ArticleParts {
  const body = text.trim();
  return {
    url: null,
    source: "pasted text",
    headline: opts?.headline?.trim() || "",
    standfirst: null,
    byline: null,
    published: null,
    body,
    extractor: "manual",
    bodyChars: body.length,
    warning: null,
  };
}

/**
 * Labelled sections; the model quotes from these and software verifies against
 * the same string. Faithful port of the reference `build_publication_text`.
 */
export function buildPublicationText(parts: ArticleParts): string {
  const lines: string[] = [];
  const fields: [string, keyof ArticleParts][] = [
    ["HEADLINE", "headline"],
    ["STANDFIRST", "standfirst"],
    ["BYLINE", "byline"],
    ["PUBLISHED", "published"],
    ["SOURCE", "source"],
  ];
  for (const [label, key] of fields) {
    const value = parts[key];
    if (value) lines.push(`${label}: ${value}`);
  }
  lines.push("");
  lines.push("BODY:");
  lines.push(parts.body || "");
  return lines.join("\n");
}
