/** One entry point the UI calls: compute(inv, params, data) -> outputs + render state. */
import { Atmosphere, GASES, LIQUIDS, SOLIDS } from "./props";
import { DropletFit, FlexTest, dropletModel } from "./droplet";
import { BurnerTest, burnerModel } from "./burner";
import { jetModel } from "./jet";
import { limitingO2, spreadModel } from "./spread";

export type Mode = "sphere" | "burner" | "jet" | "slab" | "none";
export type Prov = "MODEL" | "MEASURED" | "EXTRAPOLATED" | "ILLUSTRATIVE";

export interface Params {
  o2: number; // % vol
  p: number; // kPa
  g: number; // multiples of g0
  u: number; // m/s (opposed flow / coflow)
  T: number; // K
  geom: number; // mm: droplet d0 | nozzle ID | sample thickness (burner: unused)
  flow: number; // mg/s fuel (burner, jet)
  xf: number; // % fuel in N2 supply (burner, jet)
  co2: number; // % vol CO2 added to ambient (droplet)
  ef: number; // kV, sign = mesh polarity (jet, E-FIELD only)
  inert: "N2" | "He";
  fuel: string;
}

export interface Envelope {
  o2_pct: [number, number] | null;
  p_kpa: [number, number] | null;
  u_ms: [number, number] | null;
  gravity: string;
}

export interface Output {
  label: string;
  sym: string;
  value: string;
  unit: string;
  unc: string; // e.g. "±18 %" or "n = 4 tests"
  type: Prov;
}

export interface RenderState {
  mode: Mode;
  scale: number; // mm spanned by the view's half-height
  // sphere / burner
  rf?: number;
  rCore?: number; // droplet or burner radius, mm
  // jet / slab: flame-sheet profile, mm
  profile?: number[];
  length?: number;
  nozzleR?: number;
  thickness?: number;
  spread?: number; // mm/s (slab front speed)
  soot: number; // 0..1 luminous soot
  tf: number; // K
  g: number;
  u: number;
  extinct?: boolean;
}

export interface Result {
  mode: Mode;
  ok: boolean;
  why?: string;
  outs: Output[];
  render: RenderState | null;
  key: { label: string; unit: string; value: number; unc: number } | null;
  extrap: string[]; // reasons the configuration is outside PSI-tested conditions
  notes: string[];
}

export interface ModelData {
  flex: FlexTest[];
  fits: Record<string, DropletFit>;
  burner: BurnerTest[];
}

const f = (v: number, nd = 2) => (Number.isFinite(v) ? v.toFixed(nd) : "—");

function atm(p: Params): Atmosphere {
  return { xO2: p.o2 / 100, xCO2: p.co2 / 100, inert: p.inert, pKpa: p.p, tInf: p.T };
}

export function envelopeReasons(p: Params, env: Envelope | null, mode: Mode): string[] {
  const out: string[] = [];
  if (p.g > 0.005) out.push(`gravity ${p.g.toFixed(3)} g₀ — PSI has no partial-gravity combustion data`);
  if (!env) return out;
  const chk = (v: number, r: [number, number] | null, name: string, unit: string, tol: number) => {
    if (r && (v < r[0] - tol || v > r[1] + tol)) out.push(`${name} ${v} ${unit} outside tested ${r[0]}–${r[1]} ${unit}`);
  };
  chk(p.o2, env.o2_pct, "O₂", "%", 0.5);
  chk(p.p, env.p_kpa, "pressure", "kPa", 2);
  if (mode === "slab" || mode === "jet") chk(p.u, env.u_ms, "flow", "m/s", 0.01);
  return out;
}

export function compute(mode: Mode, p: Params, data: ModelData, env: Envelope | null): Result {
  const extrap = envelopeReasons(p, env, mode);
  const M: Prov = extrap.length ? "EXTRAPOLATED" : "MODEL";
  const a = atm(p);

  if (mode === "none") {
    return { mode, ok: false, outs: [], render: null, key: null, extrap: [], notes: [],
      why: "No flame model is defined for this investigation (aerosol / smoke or flat-burner emulator data). Explore it in the Experimental Data and Ranking tabs." };
  }

  if (mode === "sphere") {
    if (!LIQUIDS[p.fuel]) return fail(mode, `Unknown droplet fuel “${p.fuel}”.`);
    if (p.o2 < 10) return fail(mode, "X_O₂ below 10 %: outside the droplet model's range.");
    const r = dropletModel(p.fuel, a, p.geom, data.flex, data.fits);
    const unc = r.fit ? `±${r.fit.uncPct} %` : "uncalibrated";
    const meas = r.measured;
    const outs: Output[] = [
      { label: "Burning-rate const.", sym: "K", value: f(r.k), unit: "mm²/s", unc, type: M },
      { label: "Burn time (d²-law)", sym: "t_b", value: f(r.tb, 1), unit: "s", unc, type: M },
      { label: "Flame diameter (QS bound)", sym: "d_f", value: f(r.df, 1), unit: "mm", unc: "upper bound", type: M },
      { label: "Flame temperature", sym: "T_f", value: f(r.tf, 0), unit: "K", unc: "±60 K (PSI fit)", type: M },
      meas.dext != null
        ? { label: "Extinction diameter", sym: "d_ext", value: f(meas.dext), unit: "mm", unc: `median, n = ${meas.n} FLEX`, type: "MEASURED" }
        : { label: "Extinction diameter", sym: "d_ext", value: "—", unit: "", unc: "no close FLEX test", type: "MEASURED" },
      meas.k != null
        ? { label: "Measured K (nearby)", sym: "K_m", value: f(meas.k), unit: "mm²/s", unc: `median, n = ${meas.n} FLEX`, type: "MEASURED" }
        : { label: "Measured K (nearby)", sym: "K_m", value: "—", unit: "", unc: "no close FLEX test", type: "MEASURED" },
    ];
    const notes = [
      r.fit
        ? `K calibrated on ${r.fit.n} FLEX ${r.borrowed ? "n-heptane tests (borrowed for this alkane)" : `${r.fuel.label} tests`}: K = ${f(r.fit.a)}·K_theory·(P/P₀)^${f(r.fit.b)}·exp(${f(r.fit.cCO2)}·X_CO₂${r.fit.dHe ? ` ${r.fit.dHe < 0 ? "−" : "+"} ${f(Math.abs(r.fit.dHe))}·[He]` : ""}). Constant-property theory alone overpredicts K by ~${f(1 / r.fit.a, 1)}×.`
        : "No FLEX calibration for this fuel: theory only.",
      "Quasi-steady standoff ignores fuel-vapour accumulation; measured µg standoff ratios are typically smaller.",
    ];
    return {
      mode, ok: true, outs, extrap, notes,
      key: { label: "Burning-rate constant K", unit: "mm²/s", value: r.k, unc: r.fit ? r.fit.uncPct / 100 : 0.3 },
      render: { mode, scale: Math.max(r.df * 0.75, 3), rf: r.df / 2, rCore: p.geom / 2, soot: r.fuel.soot * lumO2(p.o2), tf: r.tf, g: p.g, u: 0 },
    };
  }

  if (mode === "burner") {
    if (!GASES[p.fuel]) return fail(mode, `Unknown gaseous fuel “${p.fuel}”.`);
    const r = burnerModel(p.fuel, p.xf / 100, p.flow, a, data.burner);
    const m = r.measured;
    const outs: Output[] = [
      { label: "Flame radius", sym: "r_f", value: f(r.rf, 1), unit: "mm", unc: "±20 %", type: M },
      { label: "Stoich. mixture fraction", sym: "Z_st", value: f(r.zst, 3), unit: "", unc: m.zst != null ? `PSI: ${f(m.zst, 3)}` : "—", type: M },
      { label: "Flame temperature (BS)", sym: "T_f", value: f(r.tf, 0), unit: "K", unc: m.tad != null ? `PSI T_ad ${f(m.tad, 0)}` : "±60 K (PSI fit)", type: M },
      { label: "Heat release rate", sym: "Q̇", value: f(r.heat, 1), unit: "W", unc: "exact (ṁ·LHV)", type: M },
      m.nOutcome
        ? { label: "Nearby tests self-extinguished", sym: "SE", value: `${m.selfExt}/${m.nOutcome}`, unit: "", unc: "CFI-G outcomes", type: "MEASURED" }
        : { label: "Nearby test outcomes", sym: "SE", value: "—", unit: "", unc: m.n ? `n = ${m.n}, not recorded` : "no close test", type: "MEASURED" },
    ];
    return {
      mode, ok: true, outs, extrap,
      notes: ["Z_st and T_f are computed independently and can be compared with the investigators' per-test values shown under ±."],
      key: { label: "Flame radius r_f", unit: "mm", value: r.rf, unc: 0.2 },
      render: { mode, scale: Math.max(r.rf * 1.6, 6), rf: r.rf, rCore: 3.2, soot: r.fuel.soot * lumO2(p.o2) * 0.8, tf: r.tf, g: p.g, u: 0 },
    };
  }

  if (mode === "jet") {
    if (!GASES[p.fuel]) return fail(mode, `Unknown gaseous fuel “${p.fuel}”.`);
    const r = jetModel({ fuelId: p.fuel, xFuel: p.xf / 100, mFuelMgS: p.flow, nozzleMm: p.geom, coflow: p.u, kv: p.ef, g: p.g }, a);
    const L = r.Lf;
    const profile = Array.from({ length: 32 }, (_, k) => {
      const z = (L * (k + 0.5)) / 32;
      return radiusProfile(r, z, L);
    });
    const outs: Output[] = [
      { label: "Flame length (Roper)", sym: "L_f", value: f(L, 1), unit: "mm", unc: "±15 %", type: M },
      { label: "Max flame width", sym: "W_f", value: f(2 * r.wMax, 1), unit: "mm", unc: "shape model", type: p.g > 0 || p.u > 0 || p.ef ? "ILLUSTRATIVE" : M },
      { label: "Jet exit velocity", sym: "v_e", value: f(r.ve, 3), unit: "m/s", unc: "exact", type: M },
      { label: "Jet Reynolds no.", sym: "Re", value: f(r.re, 0), unit: "", unc: r.re < 2000 ? "laminar" : "⚠ not laminar", type: M },
      { label: "Ion-wind velocity", sym: "u_i", value: f(r.ui, 3), unit: "m/s", unc: "η = 0.1 assumed", type: "ILLUSTRATIVE" },
      { label: "Flame temperature (BS)", sym: "T_f", value: f(r.tf, 0), unit: "K", unc: "±60 K (PSI fit)", type: M },
    ];
    return {
      mode, ok: true, outs, extrap,
      notes: ["Roper's L_f is gravity-independent for circular ports; buoyancy, coflow and ion wind only change the rendered width (illustrative)."],
      key: { label: "Flame length L_f", unit: "mm", value: L, unc: 0.15 },
      render: { mode, scale: Math.max(L * 0.62, 8), profile, length: L, nozzleR: r.nozzleR, soot: r.fuel.soot * lumO2(p.o2), tf: r.tf, g: p.g, u: p.u },
    };
  }

  // slab
  if (!SOLIDS[p.fuel]) return fail(mode, `Unknown material “${p.fuel}”.`);
  const r = spreadModel(p.fuel, p.geom, p.u, p.g, a);
  const loc = limitingO2(p.fuel, p.geom, p.u, p.g, a);
  if (r.extinct) {
    return {
      mode, ok: false, outs: [], render: { mode, scale: 14, profile: new Array(32).fill(0), length: 0, thickness: p.geom, soot: 0, tf: a.tInf, g: p.g, u: p.u, extinct: true },
      key: null, extrap, notes: [],
      why: `Model predicts no spread (${r.regime}). ${loc != null ? `Limiting O₂ at this flow ≈ ${(loc * 100).toFixed(1)} %.` : "No O₂ level sustains spread at this flow."}`,
    };
  }
  const L = Math.min(60, Math.max(4, r.delta * 6)); // visible flame length scales with gas layer
  const profile = Array.from({ length: 32 }, (_, k) => {
    const x = (k + 0.5) / 32; // 0 = leading edge … 1 = trailing
    return r.delta * 1.2 * Math.pow(x, 0.45) * (1 - 0.35 * x);
  });
  const outs: Output[] = [
    { label: "Flame spread rate", sym: "V_f", value: f(r.v), unit: "mm/s", unc: "±40 %", type: M },
    { label: "de Ris limit (no losses)", sym: "V_dR", value: f(r.vDeRis), unit: "mm/s", unc: r.thin ? "thermally thin" : "thermally thick", type: M },
    // Not calibrated against PSI extinction outcomes and likely non-conservative: never a screening limit.
    { label: "Limiting O₂ (this flow)", sym: "LOC", value: loc != null ? f(loc * 100, 1) : "—", unit: "%", unc: "uncalibrated", type: "ILLUSTRATIVE" },
    { label: "Radiative loss ratio", sym: "R", value: f(r.R, 3), unit: "", unc: "no fitted const.", type: M },
    { label: "Damköhler ratio", sym: "Da/Da_c", value: f(r.daRatio, 1), unit: "", unc: "kinetics assumed", type: "ILLUSTRATIVE" },
    { label: "Gas-layer thickness", sym: "δ", value: f(r.delta, 1), unit: "mm", unc: "α_g/u_eff", type: M },
  ];
  return {
    mode, ok: true, outs, extrap,
    notes: [
      `Regime: ${r.regime}. Effective opposed velocity ${f(r.uEff, 3)} m/s (buoyant part ${f(r.ub, 3)}).`,
      "The model's limiting O₂ is not calibrated against PSI extinction data and likely under-predicts the true limit (non-conservative). Do not use it for material screening.",
      ...(r.solid.note ? [r.solid.note] : []),
    ],
    key: { label: "Flame spread rate V_f", unit: "mm/s", value: r.v, unc: 0.4 },
    // Scale ≥ 14 so the 2.2-unit march volume covers the 56 mm sample.
    render: { mode, scale: Math.max(L * 0.9, 14), profile, length: L, thickness: p.geom, spread: r.v, soot: r.solid.soot * lumO2(p.o2), tf: r.tf, g: p.g, u: p.u },
  };
}

function fail(mode: Mode, why: string): Result {
  return { mode, ok: false, why, outs: [], render: null, key: null, extrap: [], notes: [] };
}

/** Luminosity rises with O2 (soot formation); purely a render cue. */
function lumO2(o2: number) {
  return Math.max(0.05, Math.min(1, (o2 - 12) / 22));
}

function radiusProfile(r: ReturnType<typeof jetModel>, zMm: number, Lmm: number) {
  // Re-evaluate the Schlichting contour in mm, closed exactly at L.
  const z = zMm / Lmm; // 0..1
  const zc = 1 / Math.max(z, 1e-3); // Z_c/Z_st with closure at z = 1
  if (zc <= 1) return 0;
  const xi = 2 * Math.sqrt(Math.sqrt(zc) - 1);
  const rr = ((xi * zMm) / r.shapeC) * r.widthFactor; // shapeC = 0.433·v_e·R/ν is dimensionless
  return Math.max(r.nozzleR, Math.min(rr, Lmm));
}

/** Sweep O2 for the response chart. */
export function sweepO2(mode: Mode, p: Params, data: ModelData, env: Envelope | null, from = 10, to = 50, n = 41) {
  const pts: { o2: number; v: number | null; unc: number }[] = [];
  for (let k = 0; k < n; k++) {
    const o2 = from + ((to - from) * k) / (n - 1);
    const r = compute(mode, { ...p, o2 }, data, env);
    pts.push({ o2, v: r.ok && r.key ? r.key.value : null, unc: r.key?.unc ?? 0 });
  }
  return pts;
}
