import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { OrgResolution } from "./types";

type Designation = {
  authority: string;
  status: string;
  scope: string;
  wing?: string;
  list_version: string;
  legal_basis: string;
  source_url: string;
  note?: string;
};

type ControlledBody = {
  name: string;
  aliases?: string[];
  relation: string;
  evidence: string;
  source_url: string;
  confidence: string;
};

type Org = {
  canonical_name: string;
  aliases: string[];
  designations: Designation[];
  controlled_bodies: ControlledBody[];
};

type OrgFile = {
  version: string;
  note: string;
  authorities: Record<string, string>;
  organizations: Org[];
};

let cache: OrgFile | null = null;

function load(): OrgFile {
  if (cache) return cache;
  const path = join(process.cwd(), "data", "designated_orgs.json");
  cache = JSON.parse(readFileSync(path, "utf-8")) as OrgFile;
  return cache;
}

export function designationListVersions(): string[] {
  const f = load();
  return [`orgs:${f.version}`, ...Object.values(f.authorities)];
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Deterministically resolve a source name (exactly as written by the model)
 * against the configured datasets. The model NEVER decides designation — only
 * this function does, and only from configured official lists.
 */
export function resolveSource(query: string): OrgResolution {
  const q = norm(query);
  if (!q) return { query, resolved: false };
  const { organizations } = load();

  for (const org of organizations) {
    for (const alias of [org.canonical_name, ...org.aliases]) {
      const a = norm(alias);
      if (a && (q === a || q.includes(a) || a.includes(q))) {
        const d = org.designations[0];
        return {
          query,
          resolved: true,
          canonical_name: org.canonical_name,
          designated: org.designations.some((x) => x.status === "designated"),
          authority: d?.authority,
          scope: d?.scope,
          wing: d?.wing,
          list_version: d?.list_version,
          legal_basis: d?.legal_basis,
          source_url: d?.source_url,
          via_controlled_body: null,
        };
      }
    }
    for (const cb of org.controlled_bodies ?? []) {
      for (const alias of [cb.name, ...(cb.aliases ?? [])]) {
        const a = norm(alias);
        if (a && (q === a || q.includes(a) || a.includes(q))) {
          const d = org.designations[0];
          return {
            query,
            resolved: true,
            canonical_name: org.canonical_name,
            designated: org.designations.some((x) => x.status === "designated"),
            authority: d?.authority,
            scope: d?.scope,
            wing: d?.wing,
            list_version: d?.list_version,
            legal_basis: d?.legal_basis,
            source_url: cb.source_url || d?.source_url,
            via_controlled_body: {
              name: cb.name,
              relation: cb.relation,
              evidence: cb.evidence,
              confidence: cb.confidence,
            },
          };
        }
      }
    }
  }
  return { query, resolved: false };
}

/** Resolve many source names, de-duplicated by query. */
export function resolveSources(names: string[]): OrgResolution[] {
  const seen = new Set<string>();
  const out: OrgResolution[] = [];
  for (const n of names) {
    const key = norm(n);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(resolveSource(n));
  }
  return out;
}
