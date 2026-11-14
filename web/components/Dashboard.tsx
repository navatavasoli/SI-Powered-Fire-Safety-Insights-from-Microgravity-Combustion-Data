"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ChatAnswer, Health, Investigation, RateLimited } from "@/lib/api";
import { compute, Envelope, ModelData, Params, Result } from "@/lib/flame";
import { calibrate } from "@/lib/flame/droplet";
import { BASE_PARAMS, DEFAULT_MODEL, ENVS, EXTRA_SPECS, MODELS, PARAM_SPECS } from "@/lib/investigations";
import Header from "./Header";
import InputsPanel from "./InputsPanel";
import Viewport from "./Viewport";
import Copilot, { ChatMsg } from "./Copilot";
import Results from "./Results";
import AboutModal from "./AboutModal";
import Hero from "./Hero";

export type Src = "preset" | "exp" | "user" | "ai";
export type Srcs = Partial<Record<keyof Params, Src>>;

export const envelopeOf = (inv: Investigation | undefined): Envelope | null =>
  inv ? { o2_pct: inv.o2_pct, p_kpa: inv.p_kpa, u_ms: inv.u_ms, gravity: inv.gravity } : null;

const ISS_REF: Partial<Params> = { o2: 21, p: 101.3, g: 0, T: 295 };

export default function Dashboard() {
  const [invs, setInvs] = useState<Investigation[]>([]);
  const [data, setData] = useState<ModelData | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [acc, setAcc] = useState("PSI-69");
  const [env, setEnv] = useState("cabin");
  const [params, setParams] = useState<Params>({ ...BASE_PARAMS, ...MODELS["PSI-69"].defaults });
  const [srcs, setSrcs] = useState<Srcs>({ o2: "preset", p: "preset", g: "preset", T: "preset", geom: "exp" });
  const [ran, setRan] = useState<{ acc: string; params: Params; result: Result; n: number } | null>(null);
  const [compare, setCompare] = useState(false);

  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [thinking, setThinking] = useState(false);

  const [leftW, setLeftW] = useState(23);
  const [rightW, setRightW] = useState(26);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [vw, setVw] = useState(1440);
  const [aboutOpen, setAboutOpen] = useState(false);

  // ---------- data load ----------
  useEffect(() => {
    Promise.all([api.investigations(), api.flexTests(), api.burnerTests()])
      .then(([i, flex, burner]) => {
        setInvs(i);
        setData({ flex, burner, fits: calibrate(flex) });
      })
      .catch((e) => setLoadErr(String(e)));
    api.health().then(setHealth).catch(() => setHealth(null));
  }, []);

  useEffect(() => {
    const on = () => setVw(window.innerWidth);
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);

  const inv = invs.find((i) => i.accession === acc);
  const model = MODELS[acc] ?? DEFAULT_MODEL;
  const envelope = envelopeOf(inv);

  const run = useCallback(
    (p: Params = params, a: string = acc) => {
      if (!data) return;
      const m = MODELS[a] ?? DEFAULT_MODEL;
      const i = invs.find((x) => x.accession === a);
      const result = compute(m.mode, p, data, envelopeOf(i));
      setRan((r) => ({ acc: a, params: p, result, n: (r?.n ?? 0) + 1 }));
    },
    [data, invs, params, acc],
  );

  // First run once data arrives.
  const booted = useRef(false);
  useEffect(() => {
    if (data && invs.length && !booted.current) {
      booted.current = true;
      run();
    }
  }, [data, invs, run]);

  const stale = !ran || ran.acc !== acc || JSON.stringify(ran.params) !== JSON.stringify(params);

  // ---------- input actions ----------
  const setParam = (k: keyof Params, v: number | string, src: Src = "user") => {
    setParams((p) => ({ ...p, [k]: v }));
    setSrcs((s) => ({ ...s, [k]: src }));
    if (["o2", "p", "g", "T"].includes(k as string) && src === "user") setEnv("custom");
  };

  const pickEnv = (id: string) => {
    setEnv(id);
    const e = ENVS.find((x) => x.id === id)!;
    if (e.o2 == null) return;
    setParams((p) => ({ ...p, o2: e.o2!, p: e.p!, g: e.g!, T: e.T! }));
    setSrcs((s) => ({ ...s, o2: "preset", p: "preset", g: "preset", T: "preset" }));
  };

  const pickInv = (a: string) => {
    const m = MODELS[a] ?? DEFAULT_MODEL;
    setAcc(a);
    setParams((p) => {
      const next = { ...p, ...m.defaults };
      if (m.fuels.length && !m.fuels.includes(next.fuel)) next.fuel = m.fuels[0];
      if (!m.ef) next.ef = 0;
      return next;
    });
    setSrcs((s) => ({ ...s, geom: "exp", flow: "exp", xf: "exp", fuel: "exp" }));
  };

  /** Snap the environment to a condition PSI actually tested for this investigation. */
  const loadPsi = () => {
    if (!inv) return;
    const near = (r: [number, number] | null, want: number) => (r ? Math.min(Math.max(want, r[0]), r[1]) : want);
    const next: Params = {
      ...params,
      ...model.defaults,
      o2: +near(inv.o2_pct, 21).toFixed(1),
      p: +near(inv.p_kpa, 101.3).toFixed(1),
      g: inv.gravity === "µg" ? 0 : 1,
      T: 298,
      u: inv.u_ms ? +near(inv.u_ms, params.u).toFixed(3) : params.u,
    };
    setParams(next);
    setEnv("custom");
    setSrcs({ o2: "exp", p: "exp", g: "exp", T: "exp", u: "exp", geom: "exp", flow: "exp", xf: "exp" });
  };

  const reset = () => {
    setParams({ ...BASE_PARAMS, ...model.defaults });
    setEnv("cabin");
    setSrcs({ o2: "preset", p: "preset", g: "preset", T: "preset", geom: "exp" });
  };

  const exportConfig = () => {
    const out = {
      tool: "CRASSUS", exported: new Date().toISOString(),
      investigation: inv ? { accession: inv.accession, name: inv.name, doi: inv.doi } : acc,
      model: model.mode, environment: env, params, sources: srcs,
      result: ran?.result ? { outputs: ran.result.outs, extrapolated: ran.result.extrap, notes: ran.result.notes } : null,
      disclaimer: "Reduced-order model output — not PSI measurements and not a validated fire-safety prediction.",
    };
    download(`crassus-${acc}-${Date.now()}.json`, JSON.stringify(out, null, 2), "application/json");
  };

  // ---------- copilot ----------
  const ranges = useMemo(() => {
    const r: Record<string, [number, number]> = {};
    for (const s of [...PARAM_SPECS, ...EXTRA_SPECS[model.mode]]) if (s.modes.includes(model.mode)) r[s.key] = [s.min, s.max];
    return r;
  }, [model.mode]);

  const ask = async (q: string) => {
    if (!q.trim() || thinking) return;
    const history = msgs.map((m) => ({ role: m.role === "user" ? "user" : "assistant",
      text: m.role === "user" ? (m.text ?? "") : (m.answer?.blocks ?? []).map((b) => b.text).join("\n") }));
    setMsgs((m) => [...m, { id: crypto.randomUUID(), role: "user", text: q }]);
    setThinking(true);
    const relevant = Object.keys(ranges) as (keyof Params)[];
    const context = {
      accession: acc,
      investigation: inv ? `${inv.name} — ${inv.title} (${acc})` : acc,
      environment: ENVS.find((e) => e.id === env)?.label,
      params: Object.fromEntries(relevant.map((k) => [k, params[k]])),
      param_ranges: ranges,
      model_outputs: ran?.result.outs.map((o) => `${o.label} ${o.value} ${o.unit} [${o.type}]`) ?? [],
    };
    try {
      const a = await api.chat(q, history, context);
      setMsgs((m) => [...m, { id: crypto.randomUUID(), role: "ai", answer: a, proposalState: a.proposal ? "pending" : undefined }]);
    } catch (e) {
      const text = e instanceof RateLimited ? e.message : `Copilot backend unreachable: ${String(e)}`;
      const err: ChatAnswer = { blocks: [{ kind: "limitation", text }], cites: [], proposal: null, mode: "retrieval-only", model: null, notice: null };
      setMsgs((m) => [...m, { id: crypto.randomUUID(), role: "ai", answer: err }]);
    } finally {
      setThinking(false);
    }
  };

  const applyProposal = (id: string) => {
    const msg = msgs.find((m) => m.id === id);
    const ch = msg?.answer?.proposal?.changes;
    if (!ch) return;
    setParams((p) => ({ ...p, ...ch }));
    setSrcs((s) => ({ ...s, ...Object.fromEntries(Object.keys(ch).map((k) => [k, "ai" as Src])) }));
    setEnv("custom");
    setMsgs((ms) => ms.map((m) => (m.id === id ? { ...m, proposalState: "applied" } : m)));
  };
  const dismissProposal = (id: string) => setMsgs((ms) => ms.map((m) => (m.id === id ? { ...m, proposalState: "dismissed" } : m)));

  // ---------- layout ----------
  const narrow = vw < 1000;
  const cols = narrow ? "1fr" : `${leftOpen ? `${leftW}%` : "42px"} minmax(0,1fr) ${rightOpen ? `${rightW}%` : "42px"}`;
  const startResize = (side: "L" | "R") => (e: React.MouseEvent) => {
    e.preventDefault();
    const x0 = e.clientX, v0 = side === "L" ? leftW : rightW;
    const move = (ev: MouseEvent) => {
      const d = ((ev.clientX - x0) / window.innerWidth) * 100;
      if (side === "L") setLeftW(Math.min(34, Math.max(16, v0 + d)));
      else setRightW(Math.min(38, Math.max(18, v0 - d)));
    };
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const reference = useMemo(() => (compare ? { ...params, ...ISS_REF } : null), [compare, params]);

  return (
    <div className="app">
      <Hero nInv={invs.length} nFlex={data?.flex.length ?? 0} nBurner={data?.burner.length ?? 0} nChunks={health?.chunks ?? null}
        onAbout={() => setAboutOpen(true)} />
      <div id="dashboard" />
      <Header health={health} nInv={invs.length} onAbout={() => setAboutOpen(true)} />
      {loadErr && (
        <div className="warn-note" style={{ padding: "8px 16px", borderBottom: "1px solid var(--line)" }}>
          Backend not reachable ({loadErr}). Start it with <span className="mono">uvicorn api.main:app --port 8000</span> from the repo root.
        </div>
      )}
      <main className="work" style={{ gridTemplateColumns: cols, height: narrow ? "auto" : "calc(100vh - 52px)", minHeight: narrow ? 0 : 640 }}>
        <InputsPanel
          open={leftOpen || narrow} onToggle={() => setLeftOpen((o) => !o)} narrow={narrow}
          invs={invs} acc={acc} onPickInv={pickInv} model={model} inv={inv}
          env={env} onPickEnv={pickEnv} params={params} srcs={srcs} setParam={setParam} envelope={envelope}
          stale={stale} canRun={!!data} onRun={() => run()} onLoadPsi={loadPsi} onReset={reset}
          compare={compare} onCompare={() => setCompare((c) => !c)} onExport={exportConfig}
          onResize={startResize("L")}
        />
        <Viewport result={ran?.result ?? null} ranParams={ran?.params ?? params} model={model} stale={stale} runN={ran?.n ?? 0} narrow={narrow} />
        <Copilot
          open={rightOpen || narrow} onToggle={() => setRightOpen((o) => !o)} narrow={narrow}
          ctx={`${inv?.name ?? acc} · ${ENVS.find((e) => e.id === env)?.label ?? "Custom"} · O₂ ${params.o2}% · ${params.p} kPa · ${params.g} g₀`}
          msgs={msgs} thinking={thinking} onAsk={ask} onApply={applyProposal} onDismiss={dismissProposal} onClear={() => setMsgs([])}
          params={params} health={health} invName={inv?.name ?? acc} onResize={startResize("R")}
        />
      </main>
      <Results
        result={ran?.result ?? null} ranParams={ran?.params ?? params} runN={ran?.n ?? 0} model={model} data={data}
        envelope={envelope} reference={reference} invs={invs} acc={acc} env={env} onSelect={pickInv}
        fuel={params.fuel}
      />
      {aboutOpen && <AboutModal health={health} onClose={() => setAboutOpen(false)} />}
    </div>
  );
}

export function download(name: string, text: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
