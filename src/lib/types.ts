export type Stance =
  | "OWN_VOICE"
  | "UNCRITICAL_AMPLIFICATION"
  | "REPORTED_CONTEXTUALISED"
  | "COUNTERED";

export type Designation =
  | "ARTICLE"
  | "OPINION"
  | "POST"
  | "DOCUMENTARY"
  | "SATIRE";

/**
 * Graded finding states (PTS v6). Absence of a detected violation is not
 * equivalent to demonstrated compliance — see UNRESOLVED / NOT_APPLICABLE.
 */
export type Severity =
  | "PASS"
  | "MINOR"
  | "MODERATE"
  | "MAJOR"
  | "SEVERE"
  | "UNRESOLVED"
  | "NOT_APPLICABLE";

/** Sharansky 3D analytical dimensions (map into AS criteria; no separate score). */
export type ThreeD = "DEMONIZATION" | "DOUBLE_STANDARDS" | "DELEGITIMIZATION";

export type ConductClause = "3" | "5" | "6" | "7" | "8" | "9";

export type LegalCategory = "NONE" | "INCITEMENT" | "HOLOCAUST_DENIAL" | "OTHER";

export type QuoteMatch = "exact" | "approximate" | "unverified";

export type Section =
  | "HEADLINE"
  | "STANDFIRST"
  | "BYLINE"
  | "PUBLISHED"
  | "SOURCE"
  | "BODY";

export type ConfidenceBand = "LOW" | "MEDIUM" | "HIGH";

/** One per-criterion judgement returned by the model. */
export type CriterionAssessment = {
  id: string;
  severity: Severity;
  evidence_quote: string;
  section?: Section | string;
  start?: number | null;
  end?: number | null;
  rationale: string;
  ihra_examples: number[];
  confidence: number;
  /** Stance of the offending passage (PTS-A). */
  failure_stance: "NONE" | Stance;
  human_review_required?: boolean;
  /** J1 / clause 8: invented facts, quotes or a fabricated source. */
  fabrication?: boolean;
};

/** A Sharansky 3D adjudication the model returns for Israel/Zionism discourse. */
export type ThreeDFinding = {
  dimension: ThreeD;
  criterion: string;
  confirmed: boolean;
  failure_stance: "NONE" | Stance;
  evidence_quote: string;
  rationale: string;
  confidence: number;
};

/** The model's adjudication of a single lexicon pre-scan hit. */
export type LexiconAdjudication = {
  id: string;
  matched_text: string;
  trope_confirmed: boolean;
  failure_stance: "NONE" | Stance;
  criterion?: string;
  reason: string;
};

/** A material factual claim extracted by the model (Block S sourcing). */
export type Claim = {
  claim: string;
  type:
    | "casualties"
    | "attribution_of_responsibility"
    | "event"
    | "statistic"
    | "other";
  /** Source names copied EXACTLY as written; the model never classifies them. */
  sources_named: string[];
  sole_source: boolean;
  used_in: ("headline" | "lead" | "body_own_voice" | "body_attributed")[];
  control_disclosed: boolean;
  marked_unverified: boolean;
  independent_corroboration: boolean;
};

export type ConductAssessment = {
  clause: ConductClause;
  engaged: boolean;
  breached: boolean;
  severity?: Severity;
  /** The specific person affected (required to engage privacy/harassment). */
  person?: string;
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

/** A single lexicon pattern hit produced by the deterministic pre-scan. */
export type LexiconHit = {
  id: string;
  strength: "hard" | "soft" | "not_indicator";
  matched_text: string;
  context_window: string;
  criterion: string;
  ihra_examples: number[];
  section: string;
  start: number;
  end: number;
};

/** Result of resolving a source name against the designation datasets. */
export type OrgResolution = {
  query: string;
  resolved: boolean;
  canonical_name?: string;
  designated?: boolean;
  authority?: string;
  scope?: string;
  wing?: string;
  list_version?: string;
  legal_basis?: string;
  source_url?: string;
  via_controlled_body?: {
    name: string;
    relation: string;
    evidence: string;
    confidence: string;
  } | null;
};

/** Raw structured output the model returns via the assessment tool. */
export type Assessment = {
  summary: string;
  language: string;
  designation: Designation;
  overall_stance: Stance;
  candidate_passages?: string[];
  criteria: CriterionAssessment[];
  three_d?: ThreeDFinding[];
  lexicon_adjudications?: LexiconAdjudication[];
  claims?: Claim[];
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
  designationHint?: Designation | null;
  mocked?: boolean;
};

export type Finding = {
  criterion: string;
  severity: Severity;
  points_lost: number;
  points_possible: number;
  stance: string;
  ihra_examples: number[];
  quote: string;
  quote_match: QuoteMatch;
  section?: string;
  rationale: string;
  confidence: number | null;
  three_d?: ThreeD | null;
  lexicon_id?: string | null;
  rung?: string | null;
};

export type RejectedFinding = {
  criterion: string;
  reason: string;
  quote: string;
  rationale: string;
};

/** A relevant criterion whose evidence was insufficient/unverifiable. */
export type UnresolvedEntry = {
  criterion: string;
  reason: string;
  quote: string;
  rationale: string;
};

export type ConductBreach = {
  clause: string;
  severity: Severity;
  quote: string;
  quote_match: QuoteMatch;
  person?: string;
  rationale: string;
  confidence: number | null;
};

export type ReviewEntry = { criterion: string; reason: string };

export type Provenance = {
  model?: string;
  prompt_version?: string;
  rubric_version?: string;
  lexicon_version?: string;
  designation_list_versions?: string[];
  run_id?: string;
  timestamp_utc?: string;
  input_sha256?: string;
  stop_reason?: string;
  usage?: Record<string, unknown>;
  designation?: Designation;
  coverage_pct?: number;
  confidence?: ConfidenceBand;
};

/** One of the two independent 100-point scores (PTS-A or PTS-J). */
export type PtsSubScore = {
  /** Deterministic score before the definitive-100 gate. */
  score: number | null;
  /** Score shown to the user (100 withheld when the gate is not met). */
  displayed_score: number | null;
  tier: string;
  raw_before_cap: number | null;
  cap_applied: boolean;
  cap_reason: string | null;
  earned: number;
  /** Assessed points (excludes UNRESOLVED and NOT_APPLICABLE). */
  possible: number;
  /** All materially applicable points (excludes only NOT_APPLICABLE). */
  applicable: number;
  coverage_pct: number;
  coverage: string;
  confidence: ConfidenceBand;
  confidence_value: number;
  unresolved_count: number;
  inconclusive: boolean;
  inconclusive_reason: string | null;
  findings: Finding[];
  rejected_findings: RejectedFinding[];
  unresolved: UnresolvedEntry[];
  not_applicable: string[];
  human_review: ReviewEntry[];
  conduct_breaches?: ConductBreach[];
};

/** The full two-score result returned by calculate_scores. */
export type Scores = {
  pts_a: PtsSubScore;
  pts_j: PtsSubScore;
  headline_score: number | null;
  designation: Designation;
  language?: string;
  overall_stance?: Stance;
  legal_flag?: LegalFlag & { note?: string };
  summary?: string;
  candidate_passages?: string[];
  three_d?: ThreeDFinding[];
  claims?: Claim[];
  lexicon_hits?: LexiconHit[];
  org_resolutions?: OrgResolution[];
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
  analysis_unavailable?: boolean;
};

export type AssessResponse = {
  parts: ArticleParts;
  assessment: Assessment | null;
  score: Scores;
};
