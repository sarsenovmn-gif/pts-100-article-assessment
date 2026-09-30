/**
 * Input normalisation for MATCHING ONLY (Part C).
 *
 * The model always reads the ORIGINAL text and quotes are always verified
 * against the ORIGINAL text. This module produces a normalised copy used solely
 * by the lexicon pre-scan and the prompt-injection detector, plus a position map
 * so a match in the normalised copy can be sliced back out of the original.
 */

// Zero-width / invisible characters to strip.
const ZERO_WIDTH = new Set([
  0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2060, 0xfeff,
]);

// Cyrillic / Greek homoglyphs commonly used inside Latin words → Latin.
const HOMOGLYPH: Record<string, string> = {
  // Cyrillic lower
  "\u0430": "a", "\u0435": "e", "\u043e": "o", "\u0440": "p", "\u0441": "c",
  "\u0445": "x", "\u0443": "y", "\u0456": "i",
  // Cyrillic upper
  "\u0410": "A", "\u0415": "E", "\u041e": "O", "\u0420": "P", "\u0421": "C",
  "\u0425": "X", "\u0423": "Y", "\u0406": "I",
  // Greek lower
  "\u03bf": "o", "\u03b1": "a", "\u03c1": "p", "\u03b5": "e", "\u03c7": "x",
  "\u03c5": "y", "\u03b9": "i",
  // Greek upper
  "\u039f": "O", "\u0391": "A", "\u03a1": "P", "\u0395": "E", "\u03a7": "X",
  "\u0399": "I",
};

// Leetspeak digits/symbols → letters (only applied inside/adjacent to words).
const LEET: Record<string, string> = {
  "3": "e", "1": "i", "0": "o", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s",
};

const WORD_SEPARATORS = new Set([".", "-", "_"]);

function isLetter(ch: string): boolean {
  return /[a-zA-Z]/.test(ch);
}

export type Normalised = {
  /** The normalised text used for matching. */
  text: string;
  /** map[i] = index into the original string of normalised char i. */
  map: number[];
};

type Entry = { ch: string; orig: number };

/**
 * Build a normalised copy of `original` with a per-character map back to the
 * original UTF-16 offsets. Substitutions are 1:1; deletions (zero-width chars,
 * collapsed separators) simply drop the entry.
 */
export function normaliseForMatching(original: string): Normalised {
  // Pass 1 — NFKC per code point, drop zero-width, homoglyph substitution.
  const entries: Entry[] = [];
  let i = 0;
  while (i < original.length) {
    const cp = original.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    const size = ch.length;
    if (!ZERO_WIDTH.has(cp)) {
      const nfkc = ch.normalize("NFKC");
      for (const c of nfkc) entries.push({ ch: HOMOGLYPH[c] ?? c, orig: i });
    }
    i += size;
  }

  // Pass 2 — collapse in-word separators and de-leet digits adjacent to letters.
  const out: Entry[] = [];
  for (let k = 0; k < entries.length; k++) {
    const e = entries[k];
    const prevCh = out.length ? out[out.length - 1].ch : "";
    const nextCh = k + 1 < entries.length ? entries[k + 1].ch : "";

    if (WORD_SEPARATORS.has(e.ch) && isLetter(prevCh) && isLetter(nextCh)) {
      continue; // drop separators inside a word: "J.e.w.s" -> "jews"
    }
    const leet = LEET[e.ch];
    if (leet && (isLetter(prevCh) || isLetter(nextCh))) {
      out.push({ ch: leet, orig: e.orig });
      continue;
    }
    out.push({ ch: e.ch, orig: e.orig });
  }

  return {
    text: out.map((e) => e.ch).join("").toLowerCase(),
    map: out.map((e) => e.orig),
  };
}

/**
 * Map a [start,end) span in the normalised text back to a [start,end) span in
 * the original string.
 */
export function mapSpanToOriginal(
  norm: Normalised,
  original: string,
  start: number,
  end: number,
): { start: number; end: number } {
  if (norm.map.length === 0) return { start: 0, end: 0 };
  const s = Math.max(0, Math.min(start, norm.map.length - 1));
  const e = Math.max(s, Math.min(end, norm.map.length));
  const origStart = norm.map[s];
  const lastIdx = norm.map[e - 1] ?? origStart;
  const lastCp = original.codePointAt(lastIdx);
  const lastLen = lastCp !== undefined ? String.fromCodePoint(lastCp).length : 1;
  return { start: origStart, end: lastIdx + lastLen };
}

// ============================================================
// Prompt-injection detection (Part D)
// ============================================================

import type { InjectionInfo } from "./types";

const INJECTION_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /ignore (all )?(the )?previous instructions/i, label: "ignore previous instructions" },
  { re: /disregard (the )?(above|previous|prior) (instructions|prompt)/i, label: "disregard instructions" },
  { re: /you are (an? )?(ai|assessment system|assessor|language model)/i, label: "addresses the AI" },
  { re: /as an ai/i, label: "as an AI" },
  { re: /rate this (article|publication|text) as/i, label: "instructs a rating" },
  { re: /\bpts[-\s]?[aj]\s*(=|:|is)?\s*100\b/i, label: "demands PTS 100" },
  { re: /return pts[-\s]?[aj]/i, label: "demands a PTS return value" },
  { re: /this (article|publication) is (fully )?compliant/i, label: "asserts compliance" },
  { re: /\bsystem prompt\b/i, label: "references the system prompt" },
  { re: /assign (a|the) (score|rating) of/i, label: "instructs a score" },
];

function splitSentences(text: string): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = [];
  // Newlines are treated as intra-sentence whitespace so a manipulation
  // instruction wrapped across lines is not split apart.
  const flat = text.replace(/[\r\n]+/g, " ");
  const re = /[^.!?]+[.!?]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(flat)) !== null) {
    const t = m[0].trim();
    if (t) out.push({ text: t, start: m.index });
  }
  return out;
}

/**
 * Detect sentences that address the assessor / try to manipulate the score.
 * Runs on the normalised text (so homoglyph/leet evasion is caught) but returns
 * the original sentence text for display.
 */
export function detectInjection(original: string): InjectionInfo {
  const norm = normaliseForMatching(original);
  const passages: { text: string; label: string }[] = [];
  for (const sent of splitSentences(norm.text)) {
    const span = mapSpanToOriginal(norm, original, sent.start, sent.start + sent.text.length);
    const originalSentence = original.slice(span.start, span.end).trim();
    for (const { re, label } of INJECTION_PATTERNS) {
      if (re.test(sent.text)) {
        passages.push({ text: originalSentence || sent.text, label });
      }
    }
  }
  return { suspected: passages.length > 0, passages };
}
