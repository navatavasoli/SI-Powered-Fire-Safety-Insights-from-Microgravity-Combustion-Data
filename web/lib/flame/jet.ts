/**
 * Laminar gas-jet diffusion flame (ACME E-FIELD, CLD, SLICE, SPICE).
 *
 * Length — Roper's correlation for circular ports (Roper 1977; Roper, Smith & Cunningham
 * 1977), with the nozzle volumetric flow evaluated at 1 atm so that, as in Roper's theory,
 * L_f is independent of pressure for a fixed mass flow and of gravity for circular ports:
 *
 *   L_f = 1330 · Q_F · (T∞/T_F) / ln(1 + 1/S),    S = x_F (x + y/4) / X_O2
 *
 * Shape — Schlichting round laminar jet similarity solution (Turns §9.4), with the
 * effective diffusivity chosen so its stoichiometric contour closes at Roper's L_f:
 *   Z(r,z) = Z_c(z) · (1 + ξ²/4)^-2,  Z_c = 3Q / (8π ν z),  ξ = 0.433 v_e R r / (ν z)
 *
 * Electric field (ion wind) — scaling u_i ≈ η · E · sqrt(ε0/ρ) with an assumed
 * efficiency η = 0.1 and a 25 mm burner–mesh gap. PSI-22's test matrix records mesh
 * polarity but no voltages, so this part is ILLUSTRATIVE, not calibrated.
 */
import { Atmosphere, GAS, GASES, R_UNIV, flameTemp, mixture, molesO2, stoichO2 } from "./props";
import { fuelMassFraction } from "./burner";

export const EPS0 = 8.854e-12;
export const ION_ETA = 0.1;
export const ELECTRODE_GAP_M = 0.025;

export interface JetInputs {
  fuelId: string;
  xFuel: number; // fuel mole fraction in N2 supply
  mFuelMgS: number; // fuel mass flow, mg/s
  nozzleMm: number; // inner diameter
  coflow: number; // m/s
  kv: number; // applied potential, kV (sign = mesh polarity: + mesh positive)
  g: number; // in g0
}

export function jetModel(i: JetInputs, a: Atmosphere) {
  const f = GASES[i.fuelId];
  const m = mixture(a);
  const tF = 298;
  const mwSupply = i.xFuel * f.mw + (1 - i.xFuel) * GAS.N2.mw;
  const yF0 = fuelMassFraction(f.mw, i.xFuel);
  const mTot = (i.mFuelMgS * 1e-6) / yF0; // kg/s
  const rhoF = (a.pKpa * 1e3 * mwSupply * 1e-3) / (R_UNIV * tF);
  const rhoF1atm = (101.325e3 * mwSupply * 1e-3) / (R_UNIV * tF);
  const Q = mTot / rhoF; // m³/s at ambient pressure
  const Q1 = mTot / rhoF1atm; // m³/s at 1 atm (Roper scaling)
  const R = (i.nozzleMm / 2) * 1e-3;
  const ve = Q / (Math.PI * R * R);
  const S = (i.xFuel * molesO2(f)) / a.xO2;
  const Lf = (1330 * Q1 * (a.tInf / tF)) / Math.log(1 + 1 / S); // m
  const nuF = stoichO2(f);
  const { zst, tf } = flameTemp(a.tInf, m.yO2, nuF, f.q, m.cpHot, yF0);

  // Jet Reynolds number (fuel-supply viscosity ~1.1e-5 Pa s for light hydrocarbons/N2).
  const re = (rhoF * ve * 2 * R) / 1.1e-5;

  // Effective ν closing the Schlichting Z_st contour at Roper's L_f.
  const nuEff = (3 * Q) / (8 * Math.PI * Lf * zst);
  const shapeC = (0.433 * ve * R) / nuEff; // ξ = C · r / z

  // Ion wind (illustrative) and narrowing by buoyancy / coflow / ion wind (illustrative).
  const E = (Math.abs(i.kv) * 1e3) / ELECTRODE_GAP_M;
  const ui = ION_ETA * E * Math.sqrt(EPS0 / m.rhoInf) * Math.sign(i.kv || 0);
  const ub = i.g > 0 ? Math.sqrt(2 * 9.81 * i.g * Lf * Math.max(0.1, tf / a.tInf - 1) * 0.5) : 0;
  const vRef = Math.max(0.3 * ve, 0.05);
  // Mesh-positive (ui>0) pushes ions downstream like buoyancy: narrower, slightly longer.
  const axialAssist = ub + i.coflow + Math.max(ui, 0);
  const widthFactor = Math.sqrt(vRef / (vRef + axialAssist)) * (ui < 0 ? 1 + Math.min(0.5, -ui / vRef * 0.3) : 1);
  const lengthFactor = ui < 0 ? 1 / (1 + Math.min(0.4, (-ui / vRef) * 0.2)) : 1 + Math.min(0.2, (ui / vRef) * 0.1);
  const L = Lf * lengthFactor;

  /** Flame radius at height z (m) from the Schlichting field. */
  const radiusAt = (z: number) => {
    const zc = (3 * Q) / (8 * Math.PI * nuEff * Math.max(z, 1e-6));
    if (zc <= zst) return 0;
    const xi = 2 * Math.sqrt(Math.sqrt(zc / zst) - 1);
    return Math.max(R, (xi * z) / shapeC) * widthFactor;
  };
  let wMax = 0;
  for (let k = 1; k <= 60; k++) wMax = Math.max(wMax, radiusAt((Lf * k) / 61));

  return {
    fuel: f,
    S,
    Lf: L * 1e3, // mm
    LfRoper: Lf * 1e3,
    wMax: wMax * 1e3, // mm (radius)
    ve,
    re,
    zst,
    tf,
    ui,
    E,
    heat: i.mFuelMgS * 1e-6 * f.q,
    shapeC,
    widthFactor,
    lengthFactor,
    nozzleR: R * 1e3,
  };
}
