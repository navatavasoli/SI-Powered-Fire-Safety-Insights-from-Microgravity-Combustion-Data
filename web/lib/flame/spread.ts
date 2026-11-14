/**
 * Opposed-flow flame spread over solids (BASS, BASS-II, Saffire).
 *
 * Heat-transfer limit — de Ris (1969), thin and thick forms:
 *   thin  V = (π/4) λ_g (T_f − T_v) / (ρ_s c_s τ (T_v − T∞))          (τ = half-thickness)
 *   thick V = u ρ_g c_g λ_g (T_f − T_v)² / (ρ_s c_s λ_s (T_v − T∞)²)
 *   The larger of the two approximates the thin→thick transition (thin ∝ 1/τ decays
 *   to the thick asymptote).
 *
 * Two loss mechanisms produce the U-shaped µg flammability boundary:
 *   radiative (low flow): R = εσ(T_v⁴ − T∞⁴) / [λ_g (T_f − T_v) · u_eff/α_g]
 *       surface re-radiation over conductive feedback across the gas layer δ = α_g/u_eff;
 *       physics only, no fitted constant.
 *   kinetic (high flow): Da/Da_c = (u_bo/u_eff)² · (P/P0) · exp(−E/R·(1/T_f − 1/T_ref))
 *       ASSUMED: u_bo = 1 m/s at T_ref = 2200 K, E/R = 15 000 K (typical one-step values),
 *       not fitted to PSI data.
 *   V = V_deRis · max(0, 1 − R − Da_c/Da). V = 0 ⇒ extinction.
 *
 * Effective opposed velocity adds a buoyant scale u_b = (g α_g ΔT/T∞)^(1/3).
 */
import { Atmosphere, P0_KPA, SIGMA, SOLIDS, Solid, alphaGas, flameTemp, mixture } from "./props";

export const KIN = { uBo: 1.0, tRef: 2200, eOverR: 15000 };

export function spreadModel(solidId: string, thicknessMm: number, u: number, g: number, a: Atmosphere) {
  const s: Solid = SOLIDS[solidId];
  const m = mixture(a);
  const { tf, zst } = flameTemp(a.tInf, m.yO2, s.nu, s.q, m.cpHot);
  const tMean = 0.5 * (tf + s.tv);
  const alpha = alphaGas(m, tMean, a.pKpa);
  const rhoG = m.lambda / (alpha * m.cp);
  const ub = g > 0 ? Math.cbrt(9.81 * g * alpha * Math.max(0, (tf - a.tInf) / a.tInf)) : 0;
  const uEff = Math.max(Math.hypot(u, ub), 1e-4);

  const tau = (thicknessMm / 2) * 1e-3;
  const dTg = Math.max(tf - s.tv, 0);
  const dTs = s.tv - a.tInf;
  const vThin = ((Math.PI / 4) * m.lambda * dTg) / (s.rho * s.c * tau * dTs);
  const vThick = (uEff * rhoG * m.cp * m.lambda * dTg * dTg) / (s.rho * s.c * s.lambda * dTs * dTs);
  // V_thin ∝ 1/τ falls toward the τ-independent thick asymptote, so the larger governs.
  const thin = vThin >= vThick;
  const vDeRis = Math.max(vThin, vThick);

  const delta = alpha / uEff; // gas-phase conduction length, m
  const R = (s.eps * SIGMA * (s.tv ** 4 - a.tInf ** 4)) / ((m.lambda * dTg) / delta);
  const daRatio = (KIN.uBo / uEff) ** 2 * (a.pKpa / P0_KPA) * Math.exp(-KIN.eOverR * (1 / tf - 1 / KIN.tRef));
  const factor = Math.max(0, 1 - R - 1 / daRatio);
  const v = vDeRis * factor;

  return {
    solid: s,
    tf,
    zst,
    alpha,
    uEff,
    ub,
    vDeRis: vDeRis * 1e3, // mm/s
    v: v * 1e3,
    thin,
    delta: delta * 1e3, // mm
    R,
    daRatio,
    factor,
    extinct: factor <= 0,
    regime: factor <= 0 ? (R > 1 - 1 / daRatio && uEff < KIN.uBo ? "radiative quench" : "kinetic blow-off") : thin ? "thermally thin" : "thermally thick",
  };
}

/** Lowest O2 mole fraction (at this flow and pressure) where the model predicts spread. */
export function limitingO2(solidId: string, thicknessMm: number, u: number, g: number, a: Atmosphere) {
  let lo = 0.05, hi = 1.0;
  if (spreadModel(solidId, thicknessMm, u, g, { ...a, xO2: hi }).extinct) return null;
  for (let k = 0; k < 40; k++) {
    const mid = 0.5 * (lo + hi);
    if (spreadModel(solidId, thicknessMm, u, g, { ...a, xO2: mid }).extinct) lo = mid;
    else hi = mid;
  }
  return hi;
}
