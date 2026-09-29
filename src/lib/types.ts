export type ArticleMeta = {
  url: string | null;
  title: string;
  standfirst: string | null;
  byline: string | null;
  published: string | null;
  source: string | null;
  body: string;
  wordCount: number;
};

export type CriterionResult = {
  id: string;
  name: string;
  description: string;
  assessable: boolean;
  score: number | null; // 0-100 when assessable, null when NOT_ASSESSABLE
  rationale: string;
  evidence: string[];
};

export type Assessment = {
  overallScore: number; // 0-100, rescaled over assessable criteria
  band: string;
  summary: string;
  criteria: CriterionResult[];
  article: ArticleMeta;
  model: string;
  mocked: boolean;
};
