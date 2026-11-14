/**
 * Thermophysical properties for the reduced-order flame models.
 * Values are standard handbook numbers (e.g. Turns, "An Introduction to Combustion",
 * App. B/C; NIST WebBook) rounded to 2–3 significant figures. They feed simple
 * analytic models, so their precision is far better than the models' own.
 */

export const SIGMA = 5.670e-8; // Stefan–Boltzmann, W/m²K⁴
export const R_UNIV = 8.314; // J/mol K
export const P0_KPA = 101.325;

/** Gas species used in ambient atmospheres. λ, cp at ~1200 K (flame-zone mean). */
export const GAS = {
  O2: { mw: 32.0, lambda: 0.0819, cp: 1090, cpHot: 1180 },
  N2: { mw: 28.01, lambda: 0.0757, cp: 1204, cpHot: 1270 },
  CO2: { mw: 44.01, lambda: 0.0807, cp: 1278, cpHot: 1370 },
  He: { mw: 4.003, lambda: 0.42, cp: 5193, cpHot: 5193 },
} as const;
export type Inert = "N2" | "He";

/** Hydrocarbon CxHy(Oz). ν = stoichiometric O2 mass per fuel mass. */
export interface GasFuel {
  id: string;
  label: string;
  mw: number;
  x: number; // C atoms
  y: number; // H atoms
  o: number; // O atoms
  q: number; // lower heating value, J/kg
  soot: number; // relative sooting propensity 0–1 (render only)
}

export interface LiquidFuel extends GasFuel {
  rhoL: number; // liquid density, kg/m³
  lv: number; // latent heat of vaporisation at Tb, J/kg
  tb: number; // normal boiling point, K
}

function nu(f: { mw: number; x: number; y: number; o: number }) {
  return ((f.x + f.y / 4 - f.o / 2) * 32.0) / f.mw;
}
export const stoichO2 = nu;
/** Moles O2 per mole fuel (for Roper's S). */
export const molesO2 = (f: { x: number; y: number; o: number }) => f.x + f.y / 4 - f.o / 2;

export const LIQUIDS: Record<string, LiquidFuel> = {
  heptane: { id: "heptane", label: "n-Heptane", mw: 100.2, x: 7, y: 16, o: 0, q: 44.6e6, rhoL: 684, lv: 316e3, tb: 371.6, soot: 0.55 },
  methanol: { id: "methanol", label: "Methanol", mw: 32.04, x: 1, y: 4, o: 1, q: 19.9e6, rhoL: 792, lv: 1100e3, tb: 337.8, soot: 0.0 },
  octane: { id: "octane", label: "n-Octane", mw: 114.2, x: 8, y: 18, o: 0, q: 44.4e6, rhoL: 703, lv: 301e3, tb: 398.8, soot: 0.6 },
  isooctane: { id: "isooctane", label: "Iso-octane", mw: 114.2, x: 8, y: 18, o: 0, q: 44.3e6, rhoL: 692, lv: 272e3, tb: 372.4, soot: 0.7 },
  decane: { id: "decane", label: "n-Decane", mw: 142.3, x: 10, y: 22, o: 0, q: 44.2e6, rhoL: 730, lv: 276e3, tb: 447.3, soot: 0.65 },
  dodecane: { id: "dodecane", label: "n-Dodecane", mw: 170.3, x: 12, y: 26, o: 0, q: 44.1e6, rhoL: 750, lv: 256e3, tb: 489.5, soot: 0.7 },
};

export const GASES: Record<string, GasFuel> = {
  methane: { id: "methane", label: "Methane", mw: 16.04, x: 1, y: 4, o: 0, q: 50.0e6, soot: 0.05 },
  ethane: { id: "ethane", label: "Ethane", mw: 30.07, x: 2, y: 6, o: 0, q: 47.5e6, soot: 0.15 },
  ethylene: { id: "ethylene", label: "Ethylene", mw: 28.05, x: 2, y: 4, o: 0, q: 47.2e6, soot: 0.75 },
  propane: { id: "propane", label: "Propane", mw: 44.1, x: 3, y: 8, o: 0, q: 46.4e6, soot: 0.35 },
  propylene: { id: "propylene", label: "Propylene", mw: 42.08, x: 3, y: 6, o: 0, q: 45.8e6, soot: 0.8 },
  butane: { id: "butane", label: "n-Butane", mw: 58.12, x: 4, y: 10, o: 0, q: 45.7e6, soot: 0.4 },
};

/** Solid fuels for opposed-flow spread. ν, q per kg of pyrolysate. */
export interface Solid {
  id: string;
  label: string;
  rho: number; // kg/m³ (bulk, for fabrics: areal density / thickness)
  c: number; // J/kg K
  lambda: number; // W/m K
  tv: number; // pyrolysis / vaporisation temperature, K
  nu: number; // stoichiometric O2 mass per fuel mass
  q: number; // heat of combustion, J/kg
  eps: number; // surface emissivity
  soot: number;
  note?: string;
}

export const SOLIDS: Record<string, Solid> = {
  pmma: { id: "pmma", label: "PMMA", rho: 1190, c: 1465, lambda: 0.19, tv: 660, nu: 1.92, q: 25.2e6, eps: 0.9, soot: 0.45 },
  sibal: { id: "sibal", label: "Cotton-fiberglass (SIBAL)", rho: 490, c: 1300, lambda: 0.08, tv: 600, nu: 1.185, q: 16.0e6, eps: 0.9, soot: 0.3,
    note: "Treated as cellulose; fibreglass (25 %) ignored except in bulk density." },
  nomex: { id: "nomex", label: "Nomex", rho: 720, c: 1200, lambda: 0.13, tv: 750, nu: 2.08, q: 21.0e6, eps: 0.9, soot: 0.6,
    note: "Approximate aramid properties; charring not modelled." },
  cellulose: { id: "cellulose", label: "Thin cellulose (tissue)", rho: 400, c: 1260, lambda: 0.08, tv: 620, nu: 1.185, q: 16.0e6, eps: 0.9, soot: 0.25 },
};

export interface Atmosphere {
  xO2: number; // mole fraction
  xCO2: number;
  inert: Inert; // balance gas
  pKpa: number;
  tInf: number; // K
}

export function mixture(a: Atmosphere) {
  const xI = Math.max(0, 1 - a.xO2 - a.xCO2);
  const I = GAS[a.inert];
  const xs = [
    [a.xO2, GAS.O2],
    [a.xCO2, GAS.CO2],
    [xI, I],
  ] as const;
  const mw = xs.reduce((s, [x, g]) => s + x * g.mw, 0);
  const y = (x: number, g: { mw: number }) => (x * g.mw) / mw;
  const cp = xs.reduce((s, [x, g]) => s + y(x, g) * g.cp, 0);
  // Product-side cp ×1.1 approximates H2O/CO2 and dissociation-free products.
  const cpHot = 1.1 * xs.reduce((s, [x, g]) => s + y(x, g) * g.cpHot, 0);
  const lambda = xs.reduce((s, [x, g]) => s + x * g.lambda, 0); // mole-weighted (crude)
  const rho = (a.pKpa * 1e3 * mw * 1e-3) / (R_UNIV * a.tInf);
  return { mw, yO2: y(a.xO2, GAS.O2), cp, cpHot, lambda, rhoInf: rho };
}

/** ρD ≈ λ/cp (unity Lewis number), kg/m s, evaluated in the flame zone. */
export const rhoD = (m: { lambda: number; cp: number }) => m.lambda / m.cp;

/** Thermal diffusivity at mean flame-zone temperature, m²/s. α ∝ T^1.7 / P. */
export function alphaGas(m: { lambda: number; cp: number; mw: number }, tMean: number, pKpa: number) {
  const rho = (pKpa * 1e3 * m.mw * 1e-3) / (R_UNIV * tMean);
  return m.lambda / (rho * m.cp);
}

/**
 * Dissociation correction: above T0 the Burke–Schumann temperature is compressed,
 *   T = T0 + (T_BS − T0) / (1 + c·(T_BS − T0)).
 * T0 and c fitted to 324 adiabatic flame temperatures reported per test by the ACME
 * Flame Design and CFI-G investigators (PSI-10, PSI-159): RMS error 631 K → 58 K.
 * Independent check: methane–air gives 2248 K vs. the textbook 2226 K.
 */
export const DISSOC = { t0: 2020, c: 8.8e-4 };

/** Burke–Schumann flame temperature (dissociation-corrected) for a fuel stream of mass fraction yF0. */
export function flameTemp(tInf: number, yO2: number, nuF: number, q: number, cpHot: number, yF0 = 1) {
  const zst = 1 / (1 + (nuF * yF0) / yO2);
  const tbs = tInf + (zst * yF0 * q) / cpHot;
  const { t0, c } = DISSOC;
  return { zst, tf: tbs <= t0 ? tbs : t0 + (tbs - t0) / (1 + c * (tbs - t0)) };
}
