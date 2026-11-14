"use client";

import { useState } from "react";
import type { Investigation } from "@/lib/api";
import type { Envelope, Params } from "@/lib/flame";
import { GASES, LIQUIDS, SOLIDS } from "@/lib/flame/props";
import { ENVS, EXTRA_SPECS, InvModel, MODEL_NAMES, MODEL_SHORT, MODELS, PARAM_SPECS, ParamSpec } from "@/lib/investigations";
import type { Src, Srcs } from "./Dashboard";

const G_PRESETS = [
  { label: "µg", v: 0 },
  { label: "Moon", v: 0.165 },
  { label: "Mars", v: 0.378 },
  { label: "Earth", v: 1 },
];
const SRC_TAG: Record<Src, { t: string; cls: string }> = {
  preset: { t: "PRESET", cls: "" },
  exp: { t: "PSI", cls: "exp" },
  user: { t: "USER", cls: "" },
  ai: { t: "COPILOT", cls: "warn" },
};

const fuelLabel = (id: string) => LIQUIDS[id]?.label ?? GASES[id]?.label ?? SOLIDS[id]?.label ?? id;

interface Props {
  open: boolean;
  narrow: boolean;
  onToggle: () => void;
  invs: Investigation[];
  acc: string;
  inv: Investigation | undefined;
  onPickInv: (a: string) => void;
  model: InvModel;
  env: string;
  onPickEnv: (id: string) => void;
  params: Params;
  srcs: Srcs;
  setParam: (k: keyof Params, v: number | string) => void;
  envelope: Envelope | null;
  stale: boolean;
  canRun: boolean;
  onRun: () => void;
  onLoadPsi: () => void;
  onReset: () => void;
  compare: boolean;
  onCompare: () => void;
  onExport: () => void;
  onResize: (e: React.MouseEvent) => void;
}

export default function InputsPanel(p: Props) {
  const [pickOpen, setPickOpen] = useState(false);
  const [q, setQ] = useState("");
  const mode = p.model.mode;

  const list = p.invs.filter((i) => {
    const s = `${i.name} ${i.title} ${i.accession} ${i.sub_area} ${i.fuels.join(" ")}`.toLowerCase();
    return !q || s.includes(q.toLowerCase());
  });

  const tested = (spec: ParamSpec): string | null => {
    const e = p.envelope;
    if (!e) return null;
    const r = spec.key === "o2" ? e.o2_pct : spec.key === "p" ? e.p_kpa : spec.key === "u" ? e.u_ms : null;
    if (spec.key === "g") return e.gravity === "µg" ? "PSI tested: µg only" : "PSI tested: 1 g";
    return r ? `PSI tested ${fmt(r[0])}–${fmt(r[1])}` : "range not reported";
  };

  const outside = (spec: ParamSpec, v: number) => {
    const e = p.envelope;
    if (!e) return null;
    if (spec.key === "g" && v > 0.005 && e.gravity === "µg") return "No PSI partial-gravity combustion data — output extrapolated.";
    const r = spec.key === "o2" ? e.o2_pct : spec.key === "p" ? e.p_kpa : spec.key === "u" && (mode === "slab" || mode === "jet") ? e.u_ms : null;
    if (r && (v < r[0] - 1e-9 || v > r[1] + 1e-9)) return `Outside the conditions PSI tested for this investigation (${fmt(r[0])}–${fmt(r[1])}).`;
    return null;
  };

  const renderParam = (spec: ParamSpec) => {
    const disabled = !spec.modes.includes(mode) || (spec.key === "ef" && !p.model.ef);
    const v = p.params[spec.key] as number;
    const src = p.srcs[spec.key] ?? "user";
    const warn = disabled ? null : outside(spec, v);
    return (
      <div key={spec.key} className="param" style={{ opacity: disabled ? 0.45 : 1 }}>
        <div className="param-top">
          <label htmlFor={`p-${spec.key}`}>{spec.label}</label>
          {!disabled && <span className={`tag ${SRC_TAG[src].cls}`}>{SRC_TAG[src].t}</span>}
          <div className="numbox">
            <input
              type="number" aria-label={`${spec.label} value`} value={v} min={spec.min} max={spec.max} step={spec.step} disabled={disabled}
              onChange={(e) => e.target.value !== "" && p.setParam(spec.key, clamp(+e.target.value, spec.min, spec.max))}
            />
            <span>{spec.unit}</span>
          </div>
        </div>
        <input id={`p-${spec.key}`} type="range" min={spec.min} max={spec.max} step={spec.step} value={v} disabled={disabled}
          onChange={(e) => p.setParam(spec.key, +e.target.value)} />
        <div className="range-lbl"><span>{spec.min}</span><span style={{ color: "var(--muted)" }}>{disabled ? "" : tested(spec)}</span><span>{spec.max}</span></div>
        {spec.key === "g" && !disabled && (
          <div className="presets">
            {G_PRESETS.map((g) => (
              <button key={g.label} className={`preset ${Math.abs(v - g.v) < 1e-3 ? "on" : ""}`} onClick={() => p.setParam("g", g.v)}>{g.label}</button>
            ))}
          </div>
        )}
        {disabled && spec.note && <span className="disabled-note">⊘ {spec.note}</span>}
        {warn && <span className="warn-note">△ {warn}</span>}
      </div>
    );
  };

  const envNote = ENVS.find((e) => e.id === p.env)?.note;

  return (
    <section className="panel panel-l" aria-label="Experimental conditions">
      <div className="phead">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#68C8FF" strokeWidth="2" strokeLinecap="round"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></svg>
        {p.open && <h2>EXPERIMENTAL CONDITIONS</h2>}
        {!p.narrow && <button className="collapse" onClick={p.onToggle} aria-label="Collapse inputs panel">{p.open ? "‹" : "›"}</button>}
      </div>
      {p.open && (
        <div className="scroll">
          <div className="sec">
            <div className="row-between"><span className="sec-title">A · INVESTIGATION</span><span className="mono" style={{ fontSize: 10, color: "var(--faint)" }}>{p.acc}</span></div>
            <button className="picker" onClick={() => setPickOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={pickOpen}>
              <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1 }}>
                <span className="picker-name">{p.inv?.name ?? p.acc}</span>
                <span className="picker-full">{p.inv?.title ?? "Loading…"}</span>
              </div>
              <span className="mono" style={{ color: "var(--accent)", fontSize: 11 }}>▾</span>
            </button>
            <div className="tags">
              <span>{p.inv?.sub_area ?? "—"}</span>
              <span>{p.inv?.gravity ?? "—"} · {p.inv?.n_tests ?? 0} test rows</span>
              <span>{MODEL_NAMES[mode]}</span>
            </div>
            {p.inv?.doi && <span className="mono" style={{ fontSize: 10.5, color: "var(--warn)" }}>DOI · <a href={`https://doi.org/${p.inv.doi}`} target="_blank" rel="noreferrer">{p.inv.doi}</a></span>}
            {p.model.note && <span className="disabled-note">ⓘ {p.model.note}</span>}
            {pickOpen && (
              <div className="dropdown" role="listbox">
                <div style={{ padding: 8, borderBottom: "1px solid var(--line)" }}>
                  <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search investigations, fuels, sub-areas…" aria-label="Search investigations" />
                </div>
                <div style={{ maxHeight: 320, overflow: "auto" }}>
                  {list.map((i) => {
                    const m = MODELS[i.accession]?.mode ?? "none";
                    return (
                      <button key={i.accession} role="option" aria-selected={i.accession === p.acc} className={`opt ${i.accession === p.acc ? "on" : ""}`}
                        onClick={() => { p.onPickInv(i.accession); setPickOpen(false); setQ(""); }}>
                        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{i.name}</span>
                        <span className="mono" style={{ fontSize: 10, color: "var(--accent)", textAlign: "right" }}>{MODEL_SHORT[m]}</span>
                        <span style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{i.title}</span>
                        <span className="mono" style={{ fontSize: 10, color: "var(--faint)", textAlign: "right" }}>{i.accession}</span>
                      </button>
                    );
                  })}
                  {!list.length && <div style={{ padding: "14px 10px", fontSize: 12, color: "var(--muted)" }}>No matching investigation in the local index.</div>}
                </div>
              </div>
            )}
          </div>

          <div className="sec">
            <span className="sec-title">B · ENVIRONMENT</span>
            <div className="env-grid">
              {ENVS.map((e) => (
                <button key={e.id} className={`env-btn ${p.env === e.id ? "on" : ""}`} aria-pressed={p.env === e.id} onClick={() => p.onPickEnv(e.id)}>{e.label}</button>
              ))}
            </div>
            {envNote && <p className="note">{envNote}</p>}
          </div>

          <div className="sec" style={{ gap: 14 }}>
            <span className="sec-title">C · ENVIRONMENTAL PARAMETERS</span>
            {PARAM_SPECS.map(renderParam)}
          </div>

          <div className="sec" style={{ gap: 12 }}>
            <span className="sec-title">D · FUEL, GEOMETRY &amp; FIELD</span>
            <div className="param">
              <label htmlFor="fuel">Fuel / material</label>
              <select id="fuel" className="select" value={p.params.fuel} disabled={!p.model.fuels.length} onChange={(e) => p.setParam("fuel", e.target.value)}>
                {p.model.fuels.map((f) => <option key={f} value={f}>{fuelLabel(f)}</option>)}
                {!p.model.fuels.length && <option>—</option>}
              </select>
              {p.inv && p.inv.fuels.length > 0 && <span className="disabled-note">PSI test matrix: {p.inv.fuels.slice(0, 4).join("; ")}{p.inv.fuels.length > 4 ? " …" : ""}</span>}
            </div>
            {mode === "sphere" && (
              <div className="param">
                <label htmlFor="inert">Balance gas</label>
                <select id="inert" className="select" value={p.params.inert} onChange={(e) => p.setParam("inert", e.target.value)}>
                  <option value="N2">N₂</option>
                  <option value="He">He (FLEX helium tests)</option>
                </select>
              </div>
            )}
            {EXTRA_SPECS[mode].map(renderParam)}
          </div>

          <div className="sec" style={{ borderBottom: "none" }}>
            <span className="sec-title">E · SIMULATION</span>
            <button className={`run ${p.stale ? "stale" : "clean"}`} onClick={p.onRun} disabled={!p.canRun}>
              <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 1 L11 6 L2 11 Z" fill="#071629" /></svg>
              {p.canRun ? (p.stale ? "RUN MODEL" : "RE-RUN MODEL") : "LOADING DATA…"}
            </button>
            <div className="btn-grid">
              <button className="btn" onClick={p.onLoadPsi} title="Snap to a condition PSI actually tested">Load PSI conditions</button>
              <button className="btn" onClick={p.onReset}>Reset</button>
              <button className={`btn ${p.compare ? "on" : ""}`} onClick={p.onCompare} aria-pressed={p.compare}>Compare w/ ISS cabin</button>
              <button className="btn" onClick={p.onExport}>Export config</button>
            </div>
          </div>
        </div>
      )}
      {!p.narrow && <div className="resize" style={{ right: -4 }} onMouseDown={p.onResize} title="Drag to resize" />}
    </section>
  );
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const fmt = (v: number) => (Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(v < 1 ? 3 : 1));
