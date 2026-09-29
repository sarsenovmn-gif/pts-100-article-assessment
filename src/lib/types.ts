export type Stance =
  | "OWN_VOICE"
  | "UNCRITICAL_AMPLIFICATION"
  | "REPORTED_CONTEXTUALISED"
  | "COUNTERED";

export type Designation = "ARTICLE" | "POST" | "DOCUMENTARY" | "SATIRE";

export type CriterionStatus = "PASS" | "FAIL" | "NOT_ASSESSABLE";

export type ConductClause = "3" | "5" | "6" | "7" | "8" | "9";

export type LegalCategory =
  | "NONE"
  | "INCITEMENT"
  | "HOLOCAUST_DENIAL"
  | "OTHER";

export type QuoteMatch = "exact" | "approximate";

export type CriterionAssessment = {
  id: string;
  status: CriterionStatus;
  evidence_quote: string;
  rationale: string;
  ihra_examples: number[];
  confidence: number;
  human_review_required: boolean;
  failure_stance: "NONE" | Stance;
  /** J1 / clause 8: invented facts, quotes or a fabricated source. */
  fabrication?: boolean;
};

export type ConductAssessment = {
  clause: ConductClause;
  engaged: boolean;
  breached: boolean;
  evidence_quote: string;
  rationale: string;
  confidence: number;
  fabrication?: boolean;
};

export type LegalFlag = {
  possible_illegal: boolean;
  category: LegalCategory;
  evidence_quote: string;
  rationale: string;
};

/** Raw structured output the model returns via the assessment tool. */
export type Assessment = {
  summary: string;
  language: string;
  designation: Designation;
  overall_stance: Stance;
  /** Passages the model flagged as touching Jews/Israel/Holocaust/antisemitism. */
  candidate_passages?: string[];
  criteria: CriterionAssessment[];
  conduct: ConductAssessment[];
  legal_flag: LegalFlag;
  _provenance?: Record<string, unknown>;
};

/** Labelled sections extracted from a URL or pasted text. */
export type ArticleParts = {
  url: string | null;
  source: string | null;
  headline: string;
  standfirst: string | null;
  byline: string | null;
  published: string | null;
  body: string;
  extractor: string;
  bodyChars: number;
  warning: string | null;
  mocked?: boolean;
};

export type Finding = {
  criterion: string;
  points_lost: number;
  stance: string;
  ihra_examples: number[];
  quote: string;
  quote_match: QuoteMatch;
  rationale: string;
  confidence: number | null;
};

export type RejectedFinding = {
  criterion: string;
  reason: string;
  quote: string;
  rationale: string;
};

export type ConductBreach = {
  clause: string;
  quote: string;
  quote_match: QuoteMatch;
  rationale: string;
  confidence: number | null;
};

export type ReviewEntry = { criterion: string; reason: string };

export type Provenance = {
  model?: string;
  prompt_version?: string;
  run_id?: string;
  timestamp_utc?: string;
  input_sha256?: string;
  stop_reason?: string;
  usage?: Record<string, unknown>;
};

/** One of the two independent 100-point scores (PTS-A or PTS-J). */
export type PtsSubScore = {
  score: number | null;
  tier: string;
  raw_before_cap: number | null;
  cap_applied: boolean;
  cap_reason: string | null;
  earned: number;
  possible: number;
  coverage: string;
  findings: Finding[];
  rejected_findings: RejectedFinding[];
  not_assessable: string[];
  human_review: ReviewEntry[];
  /** PTS-J only: verified Block D (conduct) breaches. */
  conduct_breaches?: ConductBreach[];
};

/** The full two-score result returned by calculate_scores. */
export type Scores = {
  pts_a: PtsSubScore;
  pts_j: PtsSubScore;
  /** Display convenience only — min(pts_a, pts_j); never a blended score. */
  headline_score: number | null;
  designation: Designation;
  language?: string;
  overall_stance?: Stance;
  legal_flag?: LegalFlag & { note?: string };
  summary?: string;
  candidate_passages?: string[];
  warnings?: string[];
  note?: string;
  provenance: Provenance;
  source?: {
    url: string | null;
    source: string | null;
    headline: string;
    byline: string | null;
    published: string | null;
    extractor: string;
    warning: string | null;
    body_chars: number;
  };
  mocked?: boolean;
};

export type AssessResponse = {
  parts: ArticleParts;
  assessment: Assessment;
  score: Scores;
};
