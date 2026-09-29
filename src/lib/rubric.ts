/**
 * PTS-100 assessment rubric.
 *
 * These three criteria (C1-C3) are the scaffold interpretation of the
 * Team 14 pipeline. Swap the definitions/weights here to match the exact
 * rules in team14-solutionV4.py once the source is available.
 */
export type Criterion = {
  id: string;
  name: string;
  description: string;
  guidance: string;
};

export const CRITERIA: Criterion[] = [
  {
    id: "C1",
    name: "Accuracy & Evidence",
    description:
      "Claims are supported by verifiable evidence quoted from the article.",
    guidance:
      "Reward specific, sourced facts. Penalise unsupported assertions, missing attribution, or claims that cannot be traced to evidence in the text.",
  },
  {
    id: "C2",
    name: "Fairness & Balance",
    description:
      "Relevant perspectives are represented; framing is proportionate.",
    guidance:
      "Reward multiple viewpoints and neutral framing. Penalise one-sidedness, loaded language, or omission of clearly relevant context.",
  },
  {
    id: "C3",
    name: "Clarity & Sourcing",
    description:
      "The piece is clearly written and transparent about its sources.",
    guidance:
      "Reward clear structure, named sources, and dates. Penalise vagueness, anonymous sourcing without justification, or missing provenance.",
  },
];

export const BANDS: { min: number; label: string }[] = [
  { min: 85, label: "Exemplary" },
  { min: 70, label: "Strong" },
  { min: 55, label: "Adequate" },
  { min: 40, label: "Weak" },
  { min: 0, label: "Failing" },
];

export function bandFor(score: number): string {
  return BANDS.find((b) => score >= b.min)?.label ?? "Failing";
}
