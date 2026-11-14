/**
 * Which reduced-order model applies to each PSI investigation, and with what inputs.
 * Investigation metadata (names, DOIs, tested ranges) comes from the API; only the
 * model mapping lives here.
 */
import type { Mode, Params } from "./flame";

export interface InvModel {
  mode: Mode;
  fuels: string[]; // ids in props.ts
  defaults: Partial<Params>;
  ef?: boolean; // electric-field input available (E-FIELD only)
  note?: string;
}

export const MODELS: Record<string, InvModel> = {
  "PSI-69": { mode: "sphere", fuels: ["heptane", "methanol"], defaults: { fuel: "heptane", geom: 3.0, co2: 0 } },
  "PSI-68": { mode: "sphere", fuels: ["heptane", "octane", "isooctane", "decane"], defaults: { fuel: "heptane", geom: 3.0 } },
  "PSI-39": { mode: "sphere", fuels: ["dodecane"], defaults: { fuel: "dodecane", geom: 3.0 } },
  "PSI-117": { mode: "sphere", fuels: ["heptane", "decane"], defaults: { fuel: "heptane", geom: 3.0 } },
  "PSI-142": { mode: "sphere", fuels: ["heptane"], defaults: { fuel: "heptane", geom: 3.0 } },
  "PSI-10": { mode: "burner", fuels: ["ethylene", "propane"], defaults: { fuel: "ethylene", flow: 1.0, xf: 100 } },
  "PSI-159": { mode: "burner", fuels: ["ethane", "propane", "butane"], defaults: { fuel: "ethane", flow: 1.0, xf: 100, o2: 39 } },
  "PSI-23": { mode: "burner", fuels: ["ethylene", "methane"], defaults: { fuel: "ethylene", flow: 1.0, xf: 50 } },
  "PSI-22": { mode: "jet", fuels: ["methane", "ethylene"], defaults: { fuel: "methane", flow: 1.0, xf: 100, geom: 1.6, u: 0.05 }, ef: true },
  "PSI-21": { mode: "jet", fuels: ["methane", "ethylene"], defaults: { fuel: "methane", flow: 1.0, xf: 40, geom: 1.6, u: 0.05 } },
  "PSI-106": { mode: "jet", fuels: ["methane", "ethylene"], defaults: { fuel: "methane", flow: 1.0, xf: 100, geom: 1.6, u: 0.1 } },
  "PSI-107": { mode: "jet", fuels: ["ethylene", "propane", "propylene"], defaults: { fuel: "ethylene", flow: 1.97, xf: 100, geom: 1.6, u: 0.36 } },
  "PSI-60": { mode: "jet", fuels: ["ethylene", "propane"], defaults: { fuel: "ethylene", flow: 1.97, xf: 100, geom: 1.6, u: 0.36 } },
  "PSI-25": { mode: "slab", fuels: ["pmma", "sibal", "cellulose"], defaults: { fuel: "pmma", geom: 0.2, u: 0.1 } },
  "PSI-26": { mode: "slab", fuels: ["sibal", "pmma", "cellulose"], defaults: { fuel: "sibal", geom: 0.3, u: 0.1 } },
  "PSI-98": { mode: "slab", fuels: ["sibal"], defaults: { fuel: "sibal", geom: 0.37, u: 0.2 } },
  "PSI-99": { mode: "slab", fuels: ["sibal", "pmma", "nomex"], defaults: { fuel: "sibal", geom: 0.37, u: 0.2 } },
  "PSI-100": { mode: "slab", fuels: ["sibal"], defaults: { fuel: "sibal", geom: 0.33, u: 0.25 } },
  "PSI-62": { mode: "slab", fuels: ["sibal", "pmma"], defaults: { fuel: "sibal", geom: 0.3, u: 0.1 },
    note: "PSI-62 models concurrent spread; CRASSUS only has an opposed-flow model." },
  "PSI-20": { mode: "none", fuels: [], defaults: {}, note: "BRE uses a flat porous burner to emulate burning solids; no reduced-order model yet." },
};

export const DEFAULT_MODEL: InvModel = { mode: "none", fuels: [], defaults: {} };

export const MODEL_NAMES: Record<Mode, string> = {
  sphere: "Droplet d²-law · FLEX-calibrated",
  burner: "Spherical-burner diffusion flame",
  jet: "Roper jet flame + ion wind",
  slab: "Opposed-flow spread (de Ris + losses)",
  none: "No flame model",
};
export const MODEL_SHORT: Record<Mode, string> = { sphere: "DROPLET", burner: "BURNER", jet: "JET", slab: "SPREAD", none: "—" };

export const BASE_PARAMS: Params = {
  o2: 21, p: 101.3, g: 0, u: 0.1, T: 298, geom: 3, flow: 1, xf: 100, co2: 0, ef: 0, inert: "N2", fuel: "heptane",
};

export interface ParamSpec {
  key: keyof Params;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  modes: Mode[];
  note?: string; // shown when disabled
}

export const PARAM_SPECS: ParamSpec[] = [
  { key: "o2", label: "Oxygen concentration", unit: "% vol", min: 10, max: 60, step: 0.5, modes: ["sphere", "burner", "jet", "slab"] },
  { key: "p", label: "Pressure", unit: "kPa", min: 20, max: 350, step: 0.5, modes: ["sphere", "burner", "jet", "slab"] },
  { key: "g", label: "Gravity", unit: "g₀", min: 0, max: 1, step: 0.005, modes: ["sphere", "burner", "jet", "slab"] },
  { key: "u", label: "Opposed / co-flow velocity", unit: "m/s", min: 0, max: 0.8, step: 0.005, modes: ["jet", "slab"],
    note: "Quiescent model — forced flow not represented." },
  { key: "T", label: "Ambient temperature", unit: "K", min: 250, max: 400, step: 1, modes: ["sphere", "burner", "jet", "slab"] },
];

/** Mode-specific inputs shown under "Fuel, geometry & field". */
export const EXTRA_SPECS: Record<Mode, ParamSpec[]> = {
  sphere: [
    { key: "geom", label: "Initial droplet diameter", unit: "mm", min: 0.5, max: 6, step: 0.05, modes: ["sphere"] },
    { key: "co2", label: "Added CO₂ (diluent)", unit: "% vol", min: 0, max: 60, step: 1, modes: ["sphere"] },
  ],
  burner: [
    { key: "flow", label: "Fuel mass flow", unit: "mg/s", min: 0.1, max: 6, step: 0.05, modes: ["burner"] },
    { key: "xf", label: "Fuel fraction in N₂", unit: "%", min: 3, max: 100, step: 1, modes: ["burner"] },
  ],
  jet: [
    { key: "flow", label: "Fuel mass flow", unit: "mg/s", min: 0.1, max: 6, step: 0.05, modes: ["jet"] },
    { key: "xf", label: "Fuel fraction in N₂", unit: "%", min: 10, max: 100, step: 1, modes: ["jet"] },
    { key: "geom", label: "Nozzle inner diameter", unit: "mm", min: 0.4, max: 5, step: 0.05, modes: ["jet"] },
    { key: "ef", label: "Applied potential (± = mesh polarity)", unit: "kV", min: -10, max: 10, step: 0.1, modes: ["jet"],
      note: "Electric field applies to ACME E-FIELD only." },
  ],
  slab: [{ key: "geom", label: "Sample thickness", unit: "mm", min: 0.05, max: 12, step: 0.05, modes: ["slab"] }],
  none: [],
};

export interface EnvPreset {
  id: string;
  label: string;
  o2?: number;
  p?: number;
  g?: number;
  T?: number;
  note: string;
}

export const ENVS: EnvPreset[] = [
  { id: "iss", label: "Int. Space Station", o2: 21, p: 101.3, g: 0, T: 295, note: "ISS nominal cabin (~14.7 psia, ~21 % O₂). Representative preset, not a measured experimental condition." },
  { id: "cabin", label: "Spacecraft cabin", o2: 21, p: 101.3, g: 0, T: 296, note: "Generic sea-level-equivalent cabin. Representative preset — editable." },
  { id: "lunar", label: "Lunar habitat", o2: 34, p: 56.5, g: 0.165, T: 295, note: "Exploration atmosphere (~8.2 psia, 34 % O₂) at lunar gravity. Partial-gravity output is extrapolated." },
  { id: "mars", label: "Martian habitat", o2: 34, p: 56.5, g: 0.378, T: 295, note: "Exploration atmosphere at Martian gravity. No PSI partial-gravity combustion data — extrapolated." },
  { id: "rover", label: "Pressurized rover", o2: 34, p: 56.5, g: 0.165, T: 295, note: "Rover cabin at exploration atmosphere, lunar surface. Representative preset only." },
  { id: "custom", label: "Custom", note: "Custom environment. All values user-defined." },
];

export const ASSUMPTIONS: Record<Mode, string[]> = {
  sphere: [
    "Quasi-steady, spherically symmetric d²-law; constant properties of the ambient gas at ~1200 K.",
    "Burning-rate constant calibrated per fuel on FLEX (PSI-69) measurements, incl. P, CO₂ and He corrections.",
    "Flame standoff from quasi-steady theory (overpredicts; fuel-vapour accumulation ignored).",
    "Buoyant distortion for g > 0 is a visual cue only.",
  ],
  burner: [
    "Steady spherical diffusion flame, unity Lewis number, Burke–Schumann flame sheet at Z = Z_st.",
    "ρD = λ/c_p of the ambient gas at ~1200 K; no radiative loss in the flame position.",
    "Z_st and T_f are compared against the investigators' per-test values (Flame Design, CFI-G).",
  ],
  jet: [
    "Flame length from Roper's circular-port correlation (gravity- and pressure-independent at fixed ṁ).",
    "Shape from the Schlichting laminar-jet similarity solution, closed at Roper's length.",
    "Ion wind scaled as η·E·√(ε₀/ρ), η = 0.1 and 25 mm gap assumed — PSI-22 records polarity, not voltage.",
    "No lift-off, blow-off or soot radiation physics.",
  ],
  slab: [
    "de Ris thermally thin/thick spread, larger of the two limits.",
    "Radiative quench from surface re-radiation vs. conductive feedback — no fitted constants.",
    "Kinetic (blow-off) term uses assumed one-step constants, not fitted to PSI data.",
    "Buoyancy enters as an effective opposed velocity ~(gαΔT/T)^⅓. Charring, melting, dripping ignored.",
  ],
  none: ["No flame model is defined for this investigation."],
};
