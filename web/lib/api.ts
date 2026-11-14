/** Typed client for the FastAPI backend (proxied at /api by next.config.ts). */
import type { BurnerTest } from "./flame/burner";
import type { FlexTest } from "./flame/droplet";

export interface Investigation {
  accession: string;
  acronym: string | null;
  name: string;
  title: string;
  doi: string | null;
  platform: string | null;
  hardware: string | null;
  sub_area: string | null;
  project_type: string | null;
  n_tests: number;
  tables: { file: string; n_rows: number; columns: string[] }[];
  o2_pct: [number, number] | null;
  o2_levels: number[];
  p_kpa: [number, number] | null;
  u_ms: [number, number] | null;
  fuels: string[];
  gravity: string;
  objective: string;
  start: string | null;
  end: string | null;
  license: string | null;
  n_pubs: number;
  pub_dois: string[];
  psi_url: string;
}

export interface Cite {
  n: number;
  inv: string;
  acc: string;
  doi: string | null;
  section: string;
  pub_dois: string[];
}

export interface ChatAnswer {
  blocks: { kind: "finding" | "interpretation" | "limitation"; text: string }[];
  cites: Cite[];
  proposal: { changes: Record<string, number>; why: string } | null;
  mode: "generated" | "retrieval-only";
  model: string | null;
  notice: string | null;
}

export interface RankRow {
  accession: string;
  name: string;
  title: string;
  sub_area: string | null;
  doi: string | null;
  n_tests: number;
  score: number;
  components: { topic: number; coverage: number; tagged: number };
  why: string;
  evidence: string | null;
}

export interface SafetyCat {
  title: string;
  sub: string;
  items: { kind: string; src: string; acc: string; doi: string | null; text: string }[];
}

export interface Health {
  ok: boolean;
  chunks: number;
  dense: boolean;
  llm: string | null;
  llm_error: string | null;
}

/** The copilot's per-visitor or daily limit was hit (HTTP 429 from the /api proxy). */
export class RateLimited extends Error {}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

export const api = {
  health: () => get<Health>("/api/health"),
  investigations: () => get<Investigation[]>("/api/investigations"),
  flexTests: () => get<FlexTest[]>("/api/flex-tests"),
  burnerTests: () => get<BurnerTest[]>("/api/burner-tests"),
  rank: (env: string, o2: number, p: number) => get<{ rows: RankRow[]; weights: Record<string, number> }>(
    `/api/rank?env=${encodeURIComponent(env)}&o2=${o2}&p=${p}`),
  safety: () => get<SafetyCat[]>("/api/safety"),
  chat: async (question: string, history: { role: string; text: string }[], context: Record<string, unknown>) => {
    const r = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, history, context }),
    });
    if (r.status === 429) {
      const { detail } = await r.json().catch(() => ({ detail: "Copilot rate limit reached." }));
      throw new RateLimited(detail);
    }
    if (!r.ok) throw new Error(`chat: ${r.status} ${await r.text()}`);
    return (await r.json()) as ChatAnswer;
  },
};

/** "gemini:gemini-2.5-flash" → "Gemini · gemini-2.5-flash" (provider-agnostic label). */
export function modelLabel(name: string | null | undefined, withProvider = true) {
  if (!name) return "";
  const [prov, ...rest] = name.split(":");
  const model = rest.join(":") || prov;
  const P: Record<string, string> = { gemini: "Gemini", groq: "Groq" };
  return withProvider && rest.length ? `${P[prov] ?? prov} · ${model}` : model;
}
