"use client";

import { useEffect, useRef, useState } from "react";
import type { Params, Result } from "@/lib/flame";
import { FlameRenderer } from "@/lib/flame/renderer";
import { ASSUMPTIONS, InvModel, MODEL_NAMES } from "@/lib/investigations";

interface Props {
  result: Result | null;
  ranParams: Params;
  model: InvModel;
  stale: boolean;
  runN: number;
  narrow: boolean;
}

export default function Viewport({ result, ranParams, model, stale, runN, narrow }: Props) {
  const glRef = useRef<HTMLCanvasElement>(null);
  const ovRef = useRef<HTMLCanvasElement>(null);
  const vpRef = useRef<HTMLDivElement>(null);
  const rRef = useRef<FlameRenderer | null>(null);
  const [glErr, setGlErr] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [axes, setAxes] = useState(true);
  const [assump, setAssump] = useState(false);
  const [cam, setCam] = useState({ yaw: -0.55, pitch: 0.32, zoom: 1 });
  const camRef = useRef(cam);
  camRef.current = cam;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const axesRef = useRef(axes);
  axesRef.current = axes;
  const resRef = useRef(result);
  resRef.current = result;

  // Renderer lifecycle + animation loop.
  useEffect(() => {
    const c = glRef.current!;
    let r: FlameRenderer;
    try {
      r = new FlameRenderer(c);
    } catch (e) {
      console.error("[crassus] flame renderer failed:", e);
      setGlErr(FlameRenderer.supported(document.createElement("canvas")) ? `Renderer error: ${String(e).slice(0, 300)}` : "unsupported");
      return;
    }
    rRef.current = r;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) setPaused(true);
    let raf = 0, t = 0, last = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!pausedRef.current) t += dt;
      r.cam = camRef.current;
      r.setState(resRef.current?.render ?? null);
      r.render(t);
      drawOverlay(ovRef.current, r, resRef.current, axesRef.current);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); r.dispose(); };
  }, []);

  // Wheel zoom needs a non-passive listener.
  useEffect(() => {
    const el = vpRef.current;
    if (!el) return;
    const on = (e: WheelEvent) => {
      e.preventDefault();
      setCam((c) => ({ ...c, zoom: Math.min(4, Math.max(0.4, c.zoom * (e.deltaY > 0 ? 0.92 : 1.08))) }));
    };
    el.addEventListener("wheel", on, { passive: false });
    return () => el.removeEventListener("wheel", on);
  }, []);

  const startRotate = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button, .popover")) return;
    const x0 = e.clientX, y0 = e.clientY, c0 = cam;
    const move = (ev: MouseEvent) =>
      setCam({ ...c0, yaw: c0.yaw + (ev.clientX - x0) * 0.008, pitch: Math.min(1.35, Math.max(-0.35, c0.pitch + (ev.clientY - y0) * 0.006)) });
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const snapshot = () => {
    const r = rRef.current;
    if (!r) return;
    const a = document.createElement("a");
    a.href = r.snapshot(0);
    a.download = `crassus-model-render-${Date.now()}.png`;
    a.click();
  };

  const tools = [
    { g: paused ? "▶" : "❚❚", t: paused ? "Resume animation" : "Pause animation", on: () => setPaused((v) => !v), active: paused },
    { g: "⟲", t: "Reset view", on: () => setCam({ yaw: -0.55, pitch: 0.32, zoom: 1 }), active: false },
    { g: "◧", t: "Side view", on: () => setCam((c) => ({ ...c, yaw: 0, pitch: 0.02 })), active: false },
    { g: "⊤", t: "Top view", on: () => setCam((c) => ({ ...c, yaw: 0, pitch: 1.3 })), active: false },
    { g: "⌖", t: "Axes & dimensions", on: () => setAxes((v) => !v), active: axes },
    { g: "ⓘ", t: "Model assumptions", on: () => setAssump((v) => !v), active: assump },
    { g: "⤓", t: "Save render (PNG)", on: snapshot, active: false },
  ];

  const extrap = (result?.extrap.length ?? 0) > 0;
  const status = !result
    ? { label: "NO RUN", glyph: "○", c: "var(--muted)" }
    : stale ? { label: "INPUTS CHANGED · RE-RUN", glyph: "◐", c: "var(--warn)" }
      : !result.ok ? { label: "NO SOLUTION", glyph: "⊘", c: "var(--warn)" }
        : extrap ? { label: `RUN ${runN} · EXTRAPOLATED`, glyph: "△", c: "var(--warn)" }
          : { label: `RUN ${runN} · CURRENT`, glyph: "●", c: "var(--accent)" };

  return (
    <section className="vp-wrap" aria-label="Flame visualization">
      <div className="vp-head">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FF6B24" strokeWidth="2"><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="9" stroke="#68C8FF" strokeDasharray="2 3" /></svg>
        <h2>FLAME VISUALIZATION</h2>
        <span className="mono" style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{MODEL_NAMES[model.mode]}</span>
        <div role="status" aria-live="polite" className="status" style={{ color: status.c, borderColor: status.c }}>
          <span>{status.glyph}</span>{status.label}
        </div>
      </div>
      <div ref={vpRef} className="vp" onMouseDown={startRotate} style={{ minHeight: narrow ? 420 : 0, cursor: "grab" }}>
        <canvas ref={glRef} role="img" aria-label={`Reduced-order flame model render: ${MODEL_NAMES[model.mode]}`} />
        <canvas ref={ovRef} aria-hidden="true" style={{ pointerEvents: "none" }} />

        <div style={{ position: "absolute", top: 12, left: 12, display: "flex", flexDirection: "column", gap: 6, pointerEvents: "none", maxWidth: "62%" }}>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            <span className="badge model">MODEL OUTPUT</span>
            <span className="badge plain">REDUCED-ORDER · NOT VALIDATED</span>
            {extrap && <span className="badge extrap">△ EXTRAPOLATED</span>}
          </div>
          {extrap && <span className="extrap-msg">Outside PSI-tested conditions: {result!.extrap.join("; ")}.</span>}
        </div>

        <div className="tools" onMouseDown={(e) => e.stopPropagation()}>
          {tools.map((t) => (
            <button key={t.t} className={`tool ${t.active ? "on" : ""}`} title={t.t} aria-label={t.t} aria-pressed={t.active} onClick={t.on}>{t.g}</button>
          ))}
        </div>

        {assump && (
          <div className="popover" onMouseDown={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
              <span className="sec-title" style={{ color: "var(--text)" }}>MODEL ASSUMPTIONS</span>
              <button onClick={() => setAssump(false)} aria-label="Close" style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 14 }}>×</button>
            </div>
            <ul>{ASSUMPTIONS[model.mode].map((a) => <li key={a}>{a}</li>)}</ul>
            {result?.notes.length ? <ul style={{ marginTop: 8 }}>{result.notes.map((n) => <li key={n} style={{ color: "var(--text)" }}>{n}</li>)}</ul> : null}
          </div>
        )}

        {(glErr || (result && !result.ok)) && (
          <div className="center-msg">
            <div className="center-card" style={{ borderColor: "var(--warn)" }}>
              <span className="mono" style={{ fontSize: 11, letterSpacing: ".08em", color: "var(--warn)" }}>{glErr ? (glErr === "unsupported" ? "WEBGL2 UNAVAILABLE" : "RENDERER ERROR") : "NO FLAME SOLUTION"}</span>
              <span style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                {glErr ? (glErr === "unsupported" ? "This browser cannot create a WebGL2 context; numeric outputs below are still valid." : `${glErr} — numeric outputs below are still valid.`) : result!.why}
              </span>
            </div>
          </div>
        )}

        <div className="hud">
          <span>g = <span className="v">{(ranParams.g * 9.81).toFixed(2)}</span> m/s²</span>
          <span>X_O₂ = <span className="v">{ranParams.o2}</span> %</span>
          <span>P = <span className="v">{ranParams.p}</span> kPa</span>
          <span>yaw {Math.round((cam.yaw * 180) / Math.PI)}° · pitch {Math.round((cam.pitch * 180) / Math.PI)}°</span>
        </div>
        <div className="hint">drag · rotate &nbsp; wheel · zoom</div>
      </div>
      <div className="strip">
        {(result?.outs ?? []).slice(0, 5).map((o) => (
          <div key={o.label}>
            <span className="lbl">{o.label} <span className="mono" style={{ color: "var(--faint)" }}>{o.sym}</span></span>
            <span className="val">{o.value}<span style={{ fontSize: 11, color: "var(--muted)" }}> {o.unit}</span></span>
            <span className={`unc p-${o.type}`}>{o.type === "MODEL" ? "" : `${o.type} · `}{o.unc}</span>
          </div>
        ))}
        {!result?.outs.length && <div><span className="lbl">No outputs</span><span className="val">—</span><span className="unc" style={{ color: "var(--muted)" }}>run the model</span></div>}
      </div>
    </section>
  );
}

/** Axes triad, gravity arrow and a key dimension line, projected with the GL camera. */
function drawOverlay(c: HTMLCanvasElement | null, r: FlameRenderer, res: Result | null, show: boolean) {
  if (!c) return;
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth, h = c.clientHeight;
  if (c.width !== Math.floor(w * dpr) || c.height !== Math.floor(h * dpr)) {
    c.width = Math.floor(w * dpr);
    c.height = Math.floor(h * dpr);
  }
  const ctx = c.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const s = res?.render;
  if (!show || !s) return;
  ctx.font = "10.5px 'Geist Mono', monospace";
  const line = (a: [number, number, number], b: [number, number, number], col: string, dash: number[] = []) => {
    const p = r.project(a), q = r.project(b);
    if (!p || !q) return null;
    ctx.strokeStyle = col;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    ctx.lineTo(q[0], q[1]);
    ctx.stroke();
    ctx.setLineDash([]);
    return q;
  };
  const label = (pt: [number, number] | null, t: string, col: string, dx = 4, dy = -4) => {
    if (!pt) return;
    ctx.fillStyle = col;
    ctx.fillText(t, pt[0] + dx, pt[1] + dy);
  };

  // Axes triad (mm) at the origin.
  const L = s.scale * 0.35;
  ctx.lineWidth = 1;
  label(line([0, 0, 0], [L, 0, 0], "rgba(255,107,107,.7)"), "x", "rgba(255,140,140,.9)");
  label(line([0, 0, 0], [0, L, 0], "rgba(120,230,150,.7)"), "y", "rgba(150,240,170,.9)");
  label(line([0, 0, 0], [0, 0, L], "rgba(104,200,255,.7)"), "z", "rgba(140,210,255,.9)");

  // Gravity vector.
  if (s.g > 0.005) {
    const x = -s.scale * 1.3;
    const top = line([x, s.scale * 0.6, 0], [x, -s.scale * 0.1, 0], "rgba(255,181,71,.8)");
    label(top, `g ${s.g.toFixed(3)} g₀`, "rgba(255,181,71,.95)", 6, 10);
  }

  ctx.lineWidth = 1.2;
  const dim = "rgba(234,245,255,.75)";
  if ((s.mode === "sphere" || s.mode === "burner") && s.rf) {
    const y = -s.rf * 1.25;
    line([-s.rf, y, 0], [s.rf, y, 0], dim, [4, 3]);
    line([-s.rf, 0, 0], [-s.rf, y, 0], "rgba(234,245,255,.3)");
    const end = line([s.rf, 0, 0], [s.rf, y, 0], "rgba(234,245,255,.3)");
    label(end, `${s.mode === "sphere" ? "d_f" : "2 r_f"} = ${(2 * s.rf).toFixed(1)} mm`, dim, 6, 4);
  }
  if (s.mode === "jet" && s.length && s.profile) {
    const x = Math.max(...s.profile) + s.scale * 0.15;
    line([x, 0, 0], [x, s.length, 0], dim, [4, 3]);
    label(r.project([x, s.length, 0]), `L_f = ${s.length.toFixed(1)} mm`, dim, 6, 4);
  }
  if (s.mode === "slab") {
    // Opposed flow travels +x, against the flame front which advances toward −x.
    const a = line([-26, 7, 12], [-14, 7, 12], "rgba(104,200,255,.8)");
    label(a, `u∞ ${s.u.toFixed(2)} m/s →`, "rgba(140,210,255,.95)", 6, -2);
    if (!s.extinct) label(r.project([-20, 1, 12]), `← V_f ${(s.spread ?? 0).toFixed(2)} mm/s`, dim, 0, 14);
  }
}
