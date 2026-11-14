"use client";

import { useEffect, useMemo, useState } from "react";
import { api, Investigation, RankRow, SafetyCat } from "@/lib/api";
import { Envelope, ModelData, Params, Result, sweepO2 } from "@/lib/flame";
import { ENVS, InvModel, MODEL_SHORT, MODELS } from "@/lib/investigations";
import { download } from "./Dashboard";

type Tab = "model" | "rank" | "data" | "safety";

interface Props {
  result: Result | null;
  ranParams: Params;
  runN: number;
  model: InvModel;
  data: ModelData | null;
  envelope: Envelope | null;
  reference: Params | null;
  invs: Investigation[];
  acc: string;
  env: string;
  fuel: string;
  onSelect: (acc: string) => void;
}

export default function Results(p: Props) {
  const [tab, setTab] = useState<Tab>("model");
  const tabs: { id: Tab; label: string; count?: string }[] = [
    { id: "model", label: "Model output", count: p.result?.outs.length ? String(p.result.outs.length) : "" },
    { id: "rank", label: "Relevance ranking" },
    { id: "data", label: "Experimental data", count: String(p.invs.length || "") },
    { id: "safety", label: "Fire-safety evidence" },
  ];
  return (
    <section aria-label="Results and evidence" style={{ background: "var(--bg)" }}>
      <div className="tabs-bar">
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".09em", marginRight: 14, whiteSpace: "nowrap" }}>RESULTS &amp; EVIDENCE</span>
        <div role="tablist" style={{ display: "flex", gap: 2 }}>
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab ${tab === t.id ? "on" : ""}`} onClick={() => setTab(t.id)}>
              {t.label} <span className="mono" style={{ fontSize: 10.5, color: "var(--faint)" }}>{t.count}</span>
            </button>
          ))}
        </div>
        <div className="legend">
          <span style={{ color: "var(--text)" }}>■ MEASURED</span><span style={{ color: "var(--accent)" }}>■ MODEL</span>
          <span style={{ color: "var(--warn)" }}>■ EXTRAPOLATED</span><span style={{ color: "var(--ai)" }}>■ AI INTERP.</span>
          <span style={{ color: "var(--muted)" }}>■ ILLUSTRATIVE</span>
        </div>
      </div>
      <div className="results">
        {tab === "model" && <ModelTab {...p} />}
        {tab === "rank" && <RankTab {...p} />}
        {tab === "data" && <DataTab invs={p.invs} onSelect={p.onSelect} />}
        {tab === "safety" && <SafetyTab />}
      </div>
      <footer className="footer">
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span>CRASSUS · Nava Tavasoli &amp; Jennifer Campbell.</span>
          <span>Research data from NASA Physical Sciences Informatics. 

          </span>
        </div>
      </footer>
    </section>
  );
}

// ---------------- model tab ----------------

function ModelTab({ result, ranParams, runN, model, data, envelope, reference }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const curve = useMemo(() => (data && result?.key ? sweepO2(model.mode, ranParams, data, envelope) : []), [data, result, model.mode, ranParams, envelope]);
  const ref = useMemo(() => (data && reference && result?.key ? sweepO2(model.mode, { ...reference, fuel: ranParams.fuel }, data, null) : []), [data, reference, result, model.mode, ranParams.fuel]);

  // MEASURED overlay: FLEX burning-rate constants for the same fuel / diluent family near this pressure.
  const measured = useMemo(() => {
    if (!data || model.mode !== "sphere") return [];
    return data.flex
      .filter((t) => t.fuel.toLowerCase() === ranParams.fuel && t.k_mm2s && (t.x_he > 0.05) === (ranParams.inert === "He")
        && Math.abs(t.x_co2 * 100 - ranParams.co2) <= 5 && Math.abs((t.p_kpa ?? 101.3) - ranParams.p) <= 30)
      .map((t) => ({ o2: t.x_o2 * 100, v: t.k_mm2s!, id: t.id }));
  }, [data, model.mode, ranParams]);

  const X0 = 56, X1 = 584, Y0 = 20, Y1 = 220, o2Min = 10, o2Max = 50;
  const vals = [...curve, ...ref].filter((c) => c.v != null).map((c) => c.v! * (1 + c.unc)).concat(measured.map((m) => m.v));
  const yMax = niceMax(Math.max(1e-6, ...vals));
  const sx = (o2: number) => X0 + ((o2 - o2Min) / (o2Max - o2Min)) * (X1 - X0);
  const sy = (v: number) => Y1 - (v / yMax) * (Y1 - Y0);
  const path = (pts: { o2: number; v: number | null }[], f = (v: number) => v) => {
    let d = "", pen = false;
    for (const c of pts) {
      if (c.v == null) { pen = false; continue; }
      d += `${pen ? "L" : "M"}${sx(c.o2).toFixed(1)},${sy(f(c.v)).toFixed(1)} `;
      pen = true;
    }
    return d;
  };
  const okPts = curve.filter((c) => c.v != null) as { o2: number; v: number; unc: number }[];
  const band = okPts.length
    ? `M${okPts.map((c) => `${sx(c.o2)},${sy(c.v * (1 + c.unc))}`).join(" L")} L${[...okPts].reverse().map((c) => `${sx(c.o2)},${sy(Math.max(0, c.v * (1 - c.unc)))}`).join(" L")} Z`
    : "";
  const hv = hover != null ? curve.reduce((b, c) => (Math.abs(c.o2 - hover) < Math.abs(b.o2 - hover) ? c : b), curve[0]) : null;
  const envBand = envelope?.o2_pct ? [Math.max(o2Min, envelope.o2_pct[0]), Math.min(o2Max, envelope.o2_pct[1])] : null;

  const limits = [
    ...(result?.extrap.length ? [`Extrapolated: ${result.extrap.join("; ")}.`] : []),
    ...(result?.notes ?? []),
    "PSI contains no partial-gravity combustion data; lunar / Martian results are bounded by µg and 1 g behaviour, not measured.",
    "Uncertainty bands are calibration scatter (droplets) or stated model uncertainty, not full validation error.",
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(280px,1fr) minmax(360px,1.6fr) minmax(260px,1fr)", gap: 14 }}>
      <div className="card">
        <div className="card-h"><span className="t">COMPUTED OUTPUTS</span><span className="mono" style={{ marginLeft: "auto", fontSize: 10, color: "var(--muted)" }}>run {runN}</span></div>
        <table className="data">
          <thead><tr><th>QUANTITY</th><th style={{ textAlign: "right" }}>VALUE</th><th>±</th><th>TYPE</th></tr></thead>
          <tbody>
            {(result?.outs ?? []).map((o) => (
              <tr key={o.label}>
                <td>{o.label} <span className="mono" style={{ color: "var(--faint)" }}>{o.sym}</span></td>
                <td className="mono" style={{ textAlign: "right", whiteSpace: "nowrap" }}>{o.value} <span style={{ color: "var(--muted)" }}>{o.unit}</span></td>
                <td className="mono" style={{ color: "var(--muted)", fontSize: 11 }}>{o.unc}</td>
                <td><span className={`typetag p-${o.type}`}>{o.type}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!result?.ok && <div style={{ padding: "16px 14px", fontSize: 12, color: "var(--muted)" }}>No computed outputs. {result?.why}</div>}
      </div>

      <div className="card" style={{ display: "flex", flexDirection: "column" }}>
        <div className="card-h">
          <span className="t">PARAMETER RESPONSE</span>
          <span className="mono" style={{ fontSize: 10.5, color: "var(--muted)" }}>{result?.key?.label ?? "—"} vs O₂</span>
          <div className="mono" style={{ marginLeft: "auto", display: "flex", gap: 12, fontSize: 10, color: "var(--muted)", flexWrap: "wrap" }}>
            <span><span style={{ display: "inline-block", width: 14, height: 2, background: "var(--accent)", verticalAlign: "middle" }} /> Model</span>
            {ref.length > 0 && <span><span style={{ display: "inline-block", width: 14, borderTop: "2px dashed var(--muted)", verticalAlign: "middle" }} /> ISS cabin ref.</span>}
            {measured.length > 0 && <span><span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", border: "1.5px solid var(--text)", verticalAlign: "middle" }} /> FLEX measured</span>}
            {envBand && <span><span style={{ display: "inline-block", width: 10, height: 8, background: "rgba(234,245,255,.08)", verticalAlign: "middle" }} /> PSI-tested O₂</span>}
          </div>
        </div>
        <div style={{ position: "relative", padding: "8px 10px 4px" }}>
          <svg viewBox="0 0 600 260" style={{ width: "100%", display: "block" }} role="img" aria-label={`${result?.key?.label ?? "Model output"} as a function of oxygen concentration`}
            onMouseMove={(e) => {
              const b = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
              const x = ((e.clientX - b.left) / b.width) * 600;
              setHover(x < X0 || x > X1 ? null : o2Min + ((x - X0) / (X1 - X0)) * (o2Max - o2Min));
            }}
            onMouseLeave={() => setHover(null)}>
            {envBand && <rect x={sx(envBand[0])} y={Y0} width={Math.max(1, sx(envBand[1]) - sx(envBand[0]))} height={Y1 - Y0} fill="rgba(234,245,255,.05)" />}
            {[0, 0.25, 0.5, 0.75, 1].map((f) => (
              <g key={f}>
                <line x1={X0} x2={X1} y1={sy(yMax * f)} y2={sy(yMax * f)} stroke="#193751" />
                <text x={48} y={sy(yMax * f) + 3} fill="#A4B6CA" fontSize="10" fontFamily="Geist Mono, monospace" textAnchor="end">{fmtTick(yMax * f)}</text>
              </g>
            ))}
            {[10, 20, 30, 40, 50].map((o) => (
              <g key={o}>
                <line x1={sx(o)} x2={sx(o)} y1={Y0} y2={Y1} stroke="#132B45" />
                <text x={sx(o)} y={236} fill="#A4B6CA" fontSize="10" fontFamily="Geist Mono, monospace" textAnchor="middle">{o}</text>
              </g>
            ))}
            <path d={band} fill="rgba(104,200,255,.10)" />
            {ref.length > 0 && <path d={path(ref)} fill="none" stroke="#A4B6CA" strokeWidth={1.4} strokeDasharray="5 4" />}
            <path d={path(curve)} fill="none" stroke="#68C8FF" strokeWidth={2} />
            {measured.map((m, i) => (
              // FLEX reuses some identifiers (re-runs), so the index is part of the key.
              <circle key={`${m.id}-${i}`}cx={sx(m.o2)} cy={sy(m.v)} r={3.2} fill="none" stroke="#EAF5FF" strokeWidth={1.3}><title>{`FLEX ${m.id}: K = ${m.v} mm²/s at ${m.o2.toFixed(0)} % O₂`}</title></circle>
            ))}
            {result?.key && (
              <>
                <line x1={sx(ranParams.o2)} x2={sx(ranParams.o2)} y1={sy(result.key.value * (1 + result.key.unc))} y2={sy(Math.max(0, result.key.value * (1 - result.key.unc)))} stroke="#FF6B24" strokeWidth={1.4} />
                <circle cx={sx(ranParams.o2)} cy={sy(result.key.value)} r={5} fill="#FF6B24" stroke="#071629" strokeWidth={2} />
              </>
            )}
            {hv?.v != null && (<><line x1={sx(hv.o2)} x2={sx(hv.o2)} y1={Y0} y2={Y1} stroke="#EAF5FF" strokeOpacity={0.35} /><circle cx={sx(hv.o2)} cy={sy(hv.v)} r={3.5} fill="#EAF5FF" /></>)}
            <line x1={X0} x2={X1} y1={Y1} y2={Y1} stroke="#2A4A68" /><line x1={X0} x2={X0} y1={Y0} y2={Y1} stroke="#2A4A68" />
            <text x={320} y={256} fill="#EAF5FF" fontSize="11" textAnchor="middle">Oxygen concentration, X_O₂ (% vol)</text>
            <text x={14} y={120} fill="#EAF5FF" fontSize="11" textAnchor="middle" transform="rotate(-90 14 120)">{result?.key ? `${result.key.label.split(" ").slice(-1)[0]} (${result.key.unit})` : ""}</text>
          </svg>
          {hv && hv.v != null && (
            <div className="mono" style={{ position: "absolute", top: 14, left: `${Math.min(80, ((sx(hv.o2) / 600) * 100) + 2)}%`, background: "var(--bg)", border: "1px solid var(--line-hi)", borderRadius: 4, padding: "6px 8px", fontSize: 10.5, lineHeight: 1.5, pointerEvents: "none", whiteSpace: "nowrap" }}>
              <div style={{ color: "var(--muted)" }}>X_O₂ {hv.o2.toFixed(1)} %</div><div>{hv.v.toFixed(2)} {result?.key?.unit}</div>
            </div>
          )}
        </div>
        <div className="mono" style={{ padding: "0 14px 10px", fontSize: 10, color: "var(--faint)" }}>
          Source: CRASSUS reduced-order model · band = stated uncertainty · other inputs held at the run values{measured.length ? ` · ${measured.length} FLEX tests within ±30 kPa, same diluent` : ""}
        </div>
      </div>

      <div className="card">
        <div className="card-h"><span className="t">LIMITATIONS &amp; UNCERTAINTY</span></div>
        <ul style={{ margin: 0, padding: "12px 14px 14px 28px", display: "flex", flexDirection: "column", gap: 8, fontSize: 12, lineHeight: 1.5, color: "var(--muted)" }}>
          {limits.map((l) => <li key={l}>{l}</li>)}
        </ul>
      </div>
    </div>
  );
}

// ---------------- ranking tab ----------------

function RankTab({ env, ranParams, onSelect, acc }: Props) {
  const [rows, setRows] = useState<RankRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const envLabel = ENVS.find((e) => e.id === env)?.label ?? "Custom";
  useEffect(() => {
    let live = true;
    api.rank(env, ranParams.o2, ranParams.p).then((r) => live && setRows(r.rows)).catch((e) => live && setErr(String(e)));
    return () => { live = false; };
  }, [env, ranParams.o2, ranParams.p]);
  if (err) return <div className="warn-note">{err}</div>;
  if (!rows) return <div className="small">Ranking…</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12, color: "var(--muted)", flexWrap: "wrap" }}>
        <span>Ranked for: <span className="mono" style={{ color: "var(--text)" }}>{envLabel} · O₂ {ranParams.o2} % · {ranParams.p} kPa</span></span>
        <span className="chip">RESEARCH RELEVANCE — NOT A FIRE-RISK SCORE</span>
        <span className="chip">0.55 topic retrieval + 0.30 tested-condition coverage + 0.15 PSI fire-safety tag</span>
      </div>
      {rows.map((r, i) => (
        <div key={r.accession} className="rank-row" style={{ gridTemplateColumns: "28px minmax(160px,1.3fr) minmax(120px,.8fr) minmax(200px,2fr) minmax(120px,.9fr) auto", borderColor: r.accession === acc ? "var(--flame)" : undefined }}>
          <span className="mono" style={{ fontSize: 13, color: "var(--faint)" }}>{i + 1}</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>{r.name}</span>
            <span className="small" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.title}</span>
            <span className="mono" style={{ fontSize: 10.5, color: "var(--faint)" }}>{r.accession} · {r.n_tests} test rows</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <div className="mono" style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}><span style={{ color: "var(--muted)" }}>relevance</span><span>{r.score.toFixed(2)}</span></div>
            <div className="bar"><div style={{ width: `${Math.round(r.score * 100)}%` }} /></div>
            <span className="mono" style={{ fontSize: 9.5, color: "var(--faint)" }}>T {r.components.topic.toFixed(2)} · C {r.components.coverage.toFixed(2)} · F {r.components.tagged}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="small">{r.why}</span>
            {r.evidence && <span style={{ fontSize: 11, lineHeight: 1.45, color: "var(--text)" }}>“{r.evidence}”</span>}
          </div>
          <span className="mono" style={{ fontSize: 10.5, color: "var(--warn)" }}>{r.doi ? <>DOI · <a href={`https://doi.org/${r.doi}`} target="_blank" rel="noreferrer">{r.doi}</a></> : "No dataset DOI"}</span>
          <button className="btn" style={{ height: 28, padding: "0 10px", color: "var(--accent)" }} onClick={() => onSelect(r.accession)}>Select</button>
        </div>
      ))}
    </div>
  );
}

// ---------------- data tab ----------------

const COLS: { k: string; label: string }[] = [
  { k: "name", label: "INVESTIGATION" }, { k: "fuels", label: "FUEL / MATERIAL" }, { k: "o2", label: "O₂ %" },
  { k: "p", label: "PRESSURE kPa" }, { k: "u", label: "FLOW m/s" }, { k: "gravity", label: "GRAVITY" },
  { k: "hardware", label: "APPARATUS" }, { k: "n_tests", label: "TEST ROWS" }, { k: "model", label: "MODEL" }, { k: "doi", label: "DATASET DOI" },
];

function rangeTxt(r: [number, number] | null, nd = 1) {
  if (!r) return "—";
  return r[0] === r[1] ? r[0].toFixed(nd) : `${r[0].toFixed(nd)}–${r[1].toFixed(nd)}`;
}

function DataTab({ invs, onSelect }: { invs: Investigation[]; onSelect: (a: string) => void }) {
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<{ k: string; dir: 1 | -1 }>({ k: "name", dir: 1 });
  const rows = useMemo(() => {
    const r = invs.map((i) => ({
      acc: i.accession, name: i.name, fuels: i.fuels.slice(0, 4).join("; ") + (i.fuels.length > 4 ? " …" : ""),
      o2: rangeTxt(i.o2_pct), p: rangeTxt(i.p_kpa, 0), u: rangeTxt(i.u_ms, 3), gravity: i.gravity,
      hardware: i.hardware ?? "—", n_tests: i.n_tests, model: MODEL_SHORT[MODELS[i.accession]?.mode ?? "none"], doi: i.doi ?? "—",
      _o2: i.o2_pct?.[0] ?? -1, _p: i.p_kpa?.[0] ?? -1, _u: i.u_ms?.[0] ?? -1,
    }));
    const f = filter.toLowerCase();
    const sortKey = (x: (typeof r)[number]) => (sort.k === "o2" ? x._o2 : sort.k === "p" ? x._p : sort.k === "u" ? x._u : (x as Record<string, unknown>)[sort.k]);
    return r
      .filter((x) => !f || Object.values(x).join(" ").toLowerCase().includes(f))
      .sort((a, b) => {
        const va = sortKey(a), vb = sortKey(b);
        return (typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb))) * sort.dir;
      });
  }, [invs, filter, sort]);

  const exportCsv = () => {
    const esc = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`;
    const csv = [["accession", ...COLS.map((c) => c.label)].join(","), ...rows.map((r) => [r.acc, ...COLS.map((c) => (r as Record<string, unknown>)[c.k])].map(esc).join(","))].join("\n");
    download("crassus-psi-test-envelopes.csv", csv, "text/csv");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by investigation, fuel, apparatus…" aria-label="Filter table"
          style={{ height: 30, width: 280, maxWidth: "100%", background: "var(--card)", border: "1px solid var(--line)", borderRadius: 4, color: "var(--text)", padding: "0 10px", fontSize: 12, outline: "none" }} />
        <span className="chip" style={{ color: "var(--text)" }}>MEASURED · PARSED FROM PSI TEST-MATRIX CSVs</span>
        <button className="btn" style={{ marginLeft: "auto", padding: "0 12px" }} onClick={exportCsv}>Export CSV</button>
      </div>
      <div style={{ overflowX: "auto", border: "1px solid var(--line)", borderRadius: 6 }}>
        <table className="data" style={{ minWidth: 1100, background: "var(--card)" }}>
          <thead><tr>
            {COLS.map((c) => (
              <th key={c.k} style={{ padding: 0 }} aria-sort={sort.k === c.k ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
                <button onClick={() => setSort((s) => ({ k: c.k, dir: s.k === c.k ? (-s.dir as 1 | -1) : 1 }))}
                  className="mono" style={{ width: "100%", textAlign: "left", padding: "9px 10px", background: "transparent", border: "none", color: sort.k === c.k ? "var(--text)" : "var(--faint)", fontSize: 10.5, cursor: "pointer", whiteSpace: "nowrap" }}>
                  {c.label} {sort.k === c.k ? (sort.dir === 1 ? "↑" : "↓") : ""}
                </button>
              </th>
            ))}
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.acc} onClick={() => onSelect(r.acc)} style={{ cursor: "pointer" }} title="Select this investigation">
                <td style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{r.name}<div className="mono" style={{ fontSize: 10, color: "var(--faint)", fontWeight: 400 }}>{r.acc}</div></td>
                <td>{r.fuels || "—"}</td><td className="mono">{r.o2}</td><td className="mono">{r.p}</td><td className="mono">{r.u}</td>
                <td className="mono">{r.gravity}</td><td style={{ color: "var(--muted)" }}>{r.hardware}</td><td className="mono">{r.n_tests}</td>
                <td className="mono" style={{ color: "var(--accent)" }}>{r.model}</td>
                <td className="mono" style={{ fontSize: 11 }}>{r.doi !== "—" ? <a href={`https://doi.org/${r.doi}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{r.doi}</a> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <span className="mono" style={{ fontSize: 10.5, color: "var(--faint)" }}>— = not reported in the PSI test matrix. Ranges are parsed from hand-made CSVs and may miss conditions recorded only in free-text notes.</span>
    </div>
  );
}

// ---------------- safety tab ----------------

function SafetyTab() {
  const [cats, setCats] = useState<SafetyCat[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.safety().then(setCats).catch((e) => setErr(String(e))); }, []);
  if (err) return <div className="warn-note">{err}</div>;
  if (!cats) return <div className="small">Retrieving evidence…</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <span className="small">Passages retrieved from PSI investigation records for each fire-safety function. Quoted verbatim — ask the copilot for interpretation.</span>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
        {cats.map((s) => (
          <div key={s.title} className="card">
            <div className="card-h"><span className="t">{s.title}</span><span className="small">{s.sub}</span></div>
            <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 12 }}>
              {s.items.map((i) => (
                <div key={i.acc + i.src} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <span className="typetag p-MEASURED">RETRIEVED</span>
                    <span className="mono" style={{ fontSize: 10, color: "var(--faint)" }}>{i.src}</span>
                    {i.doi && <a className="mono" style={{ fontSize: 10 }} href={`https://doi.org/${i.doi}`} target="_blank" rel="noreferrer">DOI</a>}
                  </div>
                  <span style={{ fontSize: 12, lineHeight: 1.5 }}>{i.text}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function niceMax(v: number) {
  const e = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / e;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * e;
}
function fmtTick(v: number) {
  return v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
}
