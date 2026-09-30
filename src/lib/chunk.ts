import { CHUNK_CHARS, CHUNK_OVERLAP } from "./rubric";

export type TextChunk = { index: number; text: string; start: number; end: number };

/**
 * Split a long body into overlapping chunks that end on paragraph boundaries
 * (Part C2). Short texts return a single chunk. Overlap keeps a trope that
 * straddles a boundary intact for the prosecutor.
 */
export function chunkBody(
  body: string,
  chunkChars = CHUNK_CHARS,
  overlap = CHUNK_OVERLAP,
): TextChunk[] {
  if (body.length <= chunkChars) {
    return [{ index: 0, text: body, start: 0, end: body.length }];
  }

  const chunks: TextChunk[] = [];
  let start = 0;
  let index = 0;
  while (start < body.length) {
    let end = Math.min(body.length, start + chunkChars);
    if (end < body.length) {
      // Prefer to end on a paragraph boundary within the last 25% of the window.
      const window = body.slice(start, end);
      const floor = Math.floor(chunkChars * 0.75);
      const para = window.lastIndexOf("\n\n");
      const nl = window.lastIndexOf("\n");
      const cut = para >= floor ? para : nl >= floor ? nl : -1;
      if (cut > 0) end = start + cut;
    }
    chunks.push({ index, text: body.slice(start, end), start, end });
    index++;
    if (end >= body.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}
