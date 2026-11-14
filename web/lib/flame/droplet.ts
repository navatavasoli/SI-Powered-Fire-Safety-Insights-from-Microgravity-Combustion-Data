/**
 * Isolated-droplet combustion (FLEX, FLEX-2, CFI): classical quasi-steady d²-law.
 *
 *   K = 8 (λ/cp) / ρ_l · ln(1 + B),   B = [Y_O∞ q/ν + cp (T∞ − T_s)] / L_v
 *   r_f / r_s = ln(1 + B) / ln(1 + Y_O∞/ν)              (Law; Turns ch. 10)
 *
 * The theory's K is then calibrated against measured FLEX burning-rate constants:
 *   K_cal = a_fuel · K_theory · (P/P0)^b_fuel           (least squares in log space)
 * and the residual scatter becomes the reported uncertainty.
 */
import { Atmosphere, LIQUIDS, LiquidFuel, P0_KPA, R_UNIV, flameTemp, mixture, rhoD, stoichO2 } from "./props";

export interface FlexTest {
  id: string;
  fuel: string;
  p_kpa: number | null;
  x_o2: number;
  x_n2: number;
  x_co2: number;
  x_he: number;
  d0_mm: number;
  dext_mm: number | null;
  k_mm2s: number | null;
  tb_s: number | null;
  end: string | null;
}

/** Boiling point at pressure (Clausius–Clapeyron from the normal boiling point). */
export function boilingPoint(f: LiquidFuel, pKpa: number) {
  const inv = 1 / f.tb - ((R_UNIV / (f.mw * 1e-3 * f.lv)) * Math.log(pKpa / P0_KPA));
  return 1 / inv;
}

export function dropletTheory(f: LiquidFuel, a: Atmosphere) {
  const m = mixture(a);
  const nuF = stoichO2(f);
  const ts = boilingPoint(f, a.pKpa);
  const B = (m.yO2 * f.q / nuF + m.cp * (a.tInf - ts)) / f.lv;
  const kSI = (8 * rhoD(m) / f.rhoL) * Math.log(1 + B); // m²/s
  const standoff = Math.log(1 + B) / Math.log(1 + m.yO2 / nuF);
  const { tf, zst } = flameTemp(a.tInf, m.yO2, nuF, f.q, m.cpHot);
  return { B, k: kSI * 1e6, standoff, tf, zst, ts, yO2: m.yO2 }; // k in mm²/s
}

export interface DropletFit {
  fuel: string;
  a: number;
  b: number; // pressure exponent
  cCO2: number; // per unit CO2 mole fraction (diluent the theory under-represents)
  dHe: number; // helium-balance correction (log)
  n: number;
  rmsLog: number; // RMS residual of ln K
  uncPct: number; // ≈ 1σ relative uncertainty, %
}

/** Solve the small normal-equations system A x = y (Gaussian elimination, partial pivoting). */
function solve(A: number[][], y: number[]): number[] {
  const n = y.length;
  const M = A.map((r, i) => [...r, y[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) continue; // degenerate column (e.g. no He tests): leave 0
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const k = M[r][c] / M[c][c];
      for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j];
    }
  }
  return M.map((r, i) => (Math.abs(r[i]) < 1e-12 ? 0 : r[n] / r[i]));
}

/** Correction factor applied to the theory K for one fuel's fit. */
export function fitFactor(fit: DropletFit, a: Atmosphere) {
  return fit.a * Math.pow(a.pKpa / P0_KPA, fit.b) * Math.exp(fit.cCO2 * a.xCO2 + (a.inert === "He" ? fit.dHe : 0));
}

export function atmosphereOf(t: FlexTest): Atmosphere {
  const he = t.x_he > 0.05;
  return { xO2: t.x_o2, xCO2: t.x_co2, inert: he ? "He" : "N2", pKpa: t.p_kpa ?? P0_KPA, tInf: 298 };
}

/**
 * Fit per fuel on tests with a measured K:
 *   ln(K_meas / K_theory) = ln a + b·ln(P/P0) + c·X_CO2 + d·[He balance]
 */
export function calibrate(tests: FlexTest[]): Record<string, DropletFit> {
  const out: Record<string, DropletFit> = {};
  const byFuel = new Map<string, { x: number[]; y: number }[]>();
  for (const t of tests) {
    const f = LIQUIDS[t.fuel.toLowerCase()];
    if (!f || !t.k_mm2s || t.k_mm2s <= 0) continue;
    const atm = atmosphereOf(t);
    const th = dropletTheory(f, atm);
    if (!(th.k > 0)) continue;
    const rows = byFuel.get(f.id) ?? [];
    rows.push({ x: [1, Math.log(atm.pKpa / P0_KPA), atm.xCO2, atm.inert === "He" ? 1 : 0], y: Math.log(t.k_mm2s / th.k) });
    byFuel.set(f.id, rows);
  }
  for (const [fuel, rows] of byFuel) {
    const n = rows.length, p = 4;
    const A = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => rows.reduce((s, r) => s + r.x[i] * r.x[j], 0)));
    const Y = Array.from({ length: p }, (_, i) => rows.reduce((s, r) => s + r.x[i] * r.y, 0));
    const [lnA, b, c, d] = solve(A, Y);
    const rms = Math.sqrt(rows.reduce((s, r) => s + (r.y - (lnA + b * r.x[1] + c * r.x[2] + d * r.x[3])) ** 2, 0) / Math.max(1, n - p));
    out[fuel] = { fuel, a: Math.exp(lnA), b, cCO2: c, dHe: d, n, rmsLog: rms, uncPct: Math.round((Math.exp(rms) - 1) * 100) };
  }
  return out;
}

export interface Neighbour {
  test: FlexTest;
  dist: number;
}

/** Nearest FLEX tests in (fuel, O2, CO2, He, P, d0) space; distance in "typical spacing" units. */
export function nearestFlex(tests: FlexTest[], fuel: string, a: Atmosphere, d0: number, k = 5): Neighbour[] {
  const he = a.inert === "He";
  return tests
    .filter((t) => t.fuel.toLowerCase() === fuel)
    .map((t) => {
      const tHe = t.x_he > 0.05;
      const dist = Math.hypot(
        (t.x_o2 - a.xO2) * 100 / 3, // 3 O2 points
        (t.x_co2 - a.xCO2) * 100 / 10, // 10 CO2 points
        ((t.p_kpa ?? P0_KPA) - a.pKpa) / 25, // 25 kPa
        (t.d0_mm - d0) / 1.0, // 1 mm
        tHe === he ? 0 : 3,
      );
      return { test: t, dist };
    })
    .sort((x, y) => x.dist - y.dist)
    .slice(0, k);
}

const median = (v: number[]) => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

export function dropletModel(fuelId: string, a: Atmosphere, d0: number, tests: FlexTest[], fits: Record<string, DropletFit>) {
  const f = LIQUIDS[fuelId];
  const th = dropletTheory(f, a);
  // Calibration only exists for FLEX fuels; alkanes borrow n-heptane's (documented).
  const fit = fits[fuelId] ?? (fuelId !== "methanol" ? fits.heptane : undefined);
  const borrowed = !fits[fuelId] && !!fit;
  const k = fit ? th.k * fitFactor(fit, a) : th.k;
  const near = nearestFlex(tests, fuelId, a, d0);
  const close = near.filter((n) => n.dist < 2.5);
  return {
    fuel: f,
    theory: th,
    fit,
    borrowed,
    k,
    tb: (d0 * d0) / k,
    df: th.standoff * d0,
    standoff: th.standoff,
    tf: th.tf,
    nearest: near,
    measured: {
      n: close.length,
      dext: median(close.map((n) => n.test.dext_mm).filter((v): v is number => v != null)),
      k: median(close.map((n) => n.test.k_mm2s).filter((v): v is number => v != null)),
      tb: median(close.map((n) => n.test.tb_s).filter((v): v is number => v != null)),
    },
  };
}
