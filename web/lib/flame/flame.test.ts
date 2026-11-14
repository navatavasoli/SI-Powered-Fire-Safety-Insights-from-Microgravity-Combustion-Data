import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GASES, LIQUIDS, flameTemp, mixture, stoichO2 } from "./props";
import { boilingPoint, calibrate, dropletModel, dropletTheory, FlexTest } from "./droplet";
import { BurnerTest, burnerModel, fuelMassFraction } from "./burner";
import { jetModel } from "./jet";
import { limitingO2, spreadModel } from "./spread";
import { compute, Params } from "./index";

const DERIVED = path.resolve(__dirname, "../../../backend/data/derived");
const flex: FlexTest[] = JSON.parse(readFileSync(path.join(DERIVED, "flex_tests.json"), "utf8"));
const burner: BurnerTest[] = JSON.parse(readFileSync(path.join(DERIVED, "burner_tests.json"), "utf8"));
const AIR = { xO2: 0.21, xCO2: 0, inert: "N2" as const, pKpa: 101.325, tInf: 298 };

describe("properties", () => {
  it("stoichiometry matches hand values", () => {
    expect(stoichO2(LIQUIDS.heptane)).toBeCloseTo(3.513, 2);
    expect(stoichO2(GASES.methane)).toBeCloseTo(3.99, 2);
    expect(stoichO2(LIQUIDS.methanol)).toBeCloseTo(1.498, 2);
  });
  it("air O2 mass fraction ≈ 0.233", () => {
    expect(mixture(AIR).yO2).toBeCloseTo(0.233, 3);
  });
  it("corrected flame T for methane–air is within 3 % of the adiabatic 2226 K (not in the fit)", () => {
    const { tf } = flameTemp(298, 0.233, stoichO2(GASES.methane), GASES.methane.q, mixture(AIR).cpHot);
    expect(Math.abs(tf - 2226) / 2226).toBeLessThan(0.03);
  });
  it("boiling point falls with pressure", () => {
    expect(boilingPoint(LIQUIDS.heptane, 101.325)).toBeCloseTo(371.6, 1);
    expect(boilingPoint(LIQUIDS.heptane, 50)).toBeLessThan(371.6);
  });
});

describe("droplet (FLEX)", () => {
  it("d²-law K for heptane in air is order 1 mm²/s", () => {
    const th = dropletTheory(LIQUIDS.heptane, AIR);
    expect(th.k).toBeGreaterThan(0.4);
    expect(th.k).toBeLessThan(2.5);
    expect(th.standoff).toBeGreaterThan(5); // QS theory: large standoff
  });

  const fits = calibrate(flex);
  it("calibrates on real FLEX data for both fuels with modest scatter", () => {
    expect(fits.heptane.n).toBeGreaterThan(50);
    expect(fits.methanol.n).toBeGreaterThan(50);
    for (const f of [fits.heptane, fits.methanol]) {
      // Constant-property d²-law overpredicts K (known); the correction must stay O(1).
      expect(f.a).toBeGreaterThan(0.15);
      expect(f.a).toBeLessThan(3);
      expect(f.uncPct).toBeLessThan(40);
    }
    expect(fits.methanol.uncPct).toBeLessThan(20);
  });
  it("calibrated model reproduces measured K within its stated uncertainty for most tests", () => {
    let inside = 0, total = 0;
    for (const t of flex) {
      if (!t.k_mm2s) continue;
      const atm = { xO2: t.x_o2, xCO2: t.x_co2, inert: (t.x_he > 0.05 ? "He" : "N2") as "He" | "N2", pKpa: t.p_kpa ?? 101.3, tInf: 298 };
      const r = dropletModel(t.fuel.toLowerCase(), atm, t.d0_mm, flex, fits);
      const rel = Math.abs(r.k - t.k_mm2s) / t.k_mm2s;
      total++;
      if (rel <= (r.fit!.uncPct / 100) * 2) inside++; // within 2σ
    }
    expect(inside / total).toBeGreaterThan(0.85);
  });
});

describe("spherical burner (Flame Design / CFI-G)", () => {
  it("Z_st agrees with the investigators' per-test values", () => {
    const rows = burner.filter((t) => t.zst != null && GASES[t.fuel]);
    expect(rows.length).toBeGreaterThan(100);
    let good = 0;
    for (const t of rows) {
      const r = burnerModel(t.fuel, t.x_fuel, t.mfuel_mg_s, { xO2: t.x_o2, xCO2: 0, inert: "N2", pKpa: t.p_kpa ?? 101.3, tInf: 298 });
      if (Math.abs(r.zst - t.zst!) / t.zst! < 0.1) good++;
    }
    expect(good / rows.length).toBeGreaterThan(0.8);
  });
  it("flame temperature tracks the investigators' T_ad (RMS < 100 K)", () => {
    const rows = burner.filter((t) => t.tad_k != null && GASES[t.fuel]);
    const se = rows.map((t) => {
      const r = burnerModel(t.fuel, t.x_fuel, t.mfuel_mg_s, { xO2: t.x_o2, xCO2: 0, inert: "N2", pKpa: t.p_kpa ?? 101.3, tInf: 298 });
      return (r.tf - t.tad_k!) ** 2;
    });
    expect(Math.sqrt(se.reduce((a, b) => a + b, 0) / se.length)).toBeLessThan(100);
  });
  it("flame radius is tens of mm for ~1 mg/s ethylene", () => {
    const r = burnerModel("ethylene", 1, 1, AIR);
    expect(r.rf).toBeGreaterThan(5);
    expect(r.rf).toBeLessThan(50);
    expect(fuelMassFraction(28.05, 1)).toBe(1);
  });
});

describe("jet (Roper)", () => {
  it("1 mg/s methane in air gives ~20 mm laminar flame", () => {
    const r = jetModel({ fuelId: "methane", xFuel: 1, mFuelMgS: 1, nozzleMm: 1.6, coflow: 0, kv: 0, g: 0 }, AIR);
    expect(r.LfRoper).toBeGreaterThan(15);
    expect(r.LfRoper).toBeLessThan(25);
    expect(r.re).toBeLessThan(2000);
  });
  it("length is pressure-independent at fixed mass flow and shorter with more O2", () => {
    const base = { fuelId: "methane", xFuel: 1, mFuelMgS: 1, nozzleMm: 1.6, coflow: 0, kv: 0, g: 0 };
    expect(jetModel(base, { ...AIR, pKpa: 50 }).LfRoper).toBeCloseTo(jetModel(base, AIR).LfRoper, 6);
    expect(jetModel(base, { ...AIR, xO2: 0.4 }).LfRoper).toBeLessThan(jetModel(base, AIR).LfRoper);
  });
});

describe("opposed-flow spread", () => {
  it("thin PMMA in air at 10 cm/s spreads at mm/s scale", () => {
    const r = spreadModel("pmma", 0.1, 0.1, 0, AIR);
    expect(r.extinct).toBe(false);
    expect(r.v).toBeGreaterThan(0.5);
    expect(r.v).toBeLessThan(30);
  });
  it("quiescent µg quenches radiatively; limiting O2 rises at low flow (U-curve left side)", () => {
    expect(spreadModel("sibal", 0.3, 0.001, 0, AIR).extinct).toBe(true);
    const locLow = limitingO2("cellulose", 0.1, 0.02, 0, AIR)!;
    const locMid = limitingO2("cellulose", 0.1, 0.1, 0, AIR)!;
    expect(locLow).toBeGreaterThan(locMid);
  });
  it("gravity adds buoyant flow and removes the low-flow quench", () => {
    expect(spreadModel("sibal", 0.3, 0.0, 1, AIR).extinct).toBe(false);
  });
});

describe("compute()", () => {
  const p: Params = { o2: 21, p: 101.3, g: 0, u: 0.1, T: 298, geom: 3, flow: 1, xf: 100, co2: 0, ef: 0, inert: "N2", fuel: "heptane" };
  const data = { flex, fits: calibrate(flex), burner };
  it("flags partial gravity as extrapolated", () => {
    const r = compute("sphere", { ...p, g: 0.165 }, data, null);
    expect(r.extrap.length).toBe(1);
    expect(r.outs[0].type).toBe("EXTRAPOLATED");
  });
  it("flags out-of-envelope oxygen", () => {
    const env = { o2_pct: [12, 34] as [number, number], p_kpa: [70, 310] as [number, number], u_ms: null, gravity: "µg" };
    expect(compute("sphere", { ...p, o2: 40 }, data, env).extrap.join()).toMatch(/O₂ 40/);
    expect(compute("sphere", p, data, env).extrap).toEqual([]);
  });
  it("returns measured FLEX neighbours near tested conditions", () => {
    const r = compute("sphere", p, data, null);
    expect(r.outs.some((o) => o.type === "MEASURED" && o.value !== "—")).toBe(true);
  });
  it("aerosol investigations have no flame model", () => {
    expect(compute("none", p, data, null).ok).toBe(false);
  });
});
