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

export type CriterionAssessment = {
  id: string;
  status: CriterionStatus;
  evidence_quote: string;
  rationale: string;
  ihra_examples: number[];
  confidence: number;
  human_review_required: boolean;
  failure_stance: "NONE" | Stance;
};

export type ConductAssessment = {
  clause: ConductClause;
  engaged: boolean;
  breached: boolean;
  evidence_quote: string;
  rationale: string;
  confidence: number;
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
  rationale: string;
  confidence: number | null;
};

export type ReviewEntry = { criterion: string; reason: string };

export type BlockTotals = { A: number; B: number; C: number; D: number };

export type Provenance = {
  model?: string;
  prompt_version?: string;
  run_id?: string;
  timestamp_utc?: string;
  input_sha256?: string;
  usage?: Record<string, unknown>;
};

export type ScoreResult = {
  designation: Designation;
  language?: string;
  overall_stance?: Stance;
  final_score: number | null;
  tier: string;
  raw_score_before_cap?: number | null;
  cap_applied?: boolean;
  cap_reason?: string | null;
  points?: {
    earned: BlockTotals;
    possible: BlockTotals;
    coverage: string;
  };
  not_assessable?: string[];
  findings?: Finding[];
  conduct_breaches?: ConductBreach[];
  rejected_findings?: RejectedFinding[];
  human_review?: ReviewEntry[];
  legal_flag?: LegalFlag & { note?: string };
  summary?: string;
  note?: string;
  warnings?: string[];
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
  score: ScoreResult;
};
