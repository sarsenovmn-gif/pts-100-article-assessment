import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mapSpanToOriginal, normaliseForMatching } from "./normalise";
import type { LexiconHit } from "./types";

type LexiconEntry = {
  id: string;
  pattern: string;
  languages: string[];
  strength: "hard" | "soft" | "not_indicator";
  ihra_examples: number[];
  criterion: string;
  context_rule: string;
  source: string;
  version: string;
};

type LexiconFile = {
  version: string;
  note: string;
  entries: LexiconEntry[];
};

let cache: LexiconFile | null = null;

function load(): LexiconFile {
  if (cache) return cache;
  const path = join(process.cwd(), "data", "lexicon.json");
  cache = JSON.parse(readFileSync(path, "utf-8")) as LexiconFile;
  return cache;
}

export function lexiconVersion(): string {
  return load().version;
}

const CONTEXT_RADIUS = 200;

/**
 * Deterministic pre-scan. Every pattern is matched case-insensitively and
 * Unicode-aware against a NORMALISED copy of each section (NFKC, homoglyph and
 * leetspeak folded, zero-width stripped — see normalise.ts), then mapped back to
 * the ORIGINAL text so the matched_text and context window come from what the
 * model actually reads. Hits are indicators only — the model must adjudicate
 * each one. A hit that only matched after normalisation carries `normalised`.
 */
export function prescan(
  sections: { section: string; text: string }[],
  language?: string | null,
): LexiconHit[] {
  const { entries } = load();
  const lang = (language || "en").toLowerCase().slice(0, 2);
  const hits: LexiconHit[] = [];

  const normed = sections.map((s) => ({
    section: s.section,
    original: s.text,
    norm: normaliseForMatching(s.text),
  }));

  for (const entry of entries) {
    if (
      entry.languages &&
      entry.languages.length > 0 &&
      !entry.languages.map((l) => l.toLowerCase()).includes(lang)
    ) {
      continue;
    }
    let re: RegExp;
    try {
      re = new RegExp(entry.pattern, "giu");
    } catch {
      try {
        re = new RegExp(entry.pattern, "gi");
      } catch {
        continue;
      }
    }
    for (const { section, original, norm } of normed) {
      if (!norm.text) continue;
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(norm.text)) !== null) {
        const nStart = m.index;
        const nEnd = m.index + m[0].length;
        const { start, end } = mapSpanToOriginal(norm, original, nStart, nEnd);
        const matched = original.slice(start, end);
        const normalisedOnly = matched.toLowerCase() !== m[0].toLowerCase();
        const from = Math.max(0, start - CONTEXT_RADIUS);
        const to = Math.min(original.length, end + CONTEXT_RADIUS);
        hits.push({
          id: entry.id,
          strength: entry.strength,
          matched_text: matched || m[0],
          context_window: original.slice(from, to),
          criterion: entry.criterion,
          ihra_examples: entry.ihra_examples ?? [],
          section,
          start,
          end,
          normalised: normalisedOnly,
          normalisation_note: normalisedOnly
            ? `matched after normalisation ("${m[0]}")`
            : undefined,
        });
        if (m[0].length === 0) re.lastIndex++;
      }
    }
  }
  return hits;
}

/** Render pre-scan hits for injection into the model request. */
export function formatHitsForPrompt(hits: LexiconHit[]): string {
  const relevant = hits.filter((h) => h.strength !== "not_indicator");
  if (relevant.length === 0) {
    return "LEXICON PRE-SCAN: no coded-language indicators matched.";
  }
  const lines = relevant.map(
    (h, i) =>
      `${i + 1}. id=${h.id} strength=${h.strength} criterion=${h.criterion} ` +
      `section=${h.section} matched=${JSON.stringify(h.matched_text)}` +
      (h.normalised ? " [matched after normalisation]" : "") +
      `\n   context: ${JSON.stringify(h.context_window)}`,
  );
  return (
    "LEXICON PRE-SCAN HITS (indicators only — adjudicate EACH in " +
    "lexicon_adjudications[]; a hit is not automatically a finding):\n" +
    lines.join("\n")
  );
}
