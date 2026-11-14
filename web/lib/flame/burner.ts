/**
 * Spherical porous-burner diffusion flame (ACME Flame Design, CFI-G, s-Flame), normal
 * configuration (fuel issues into ambient oxidizer). Steady, spherically symmetric,
 * unity Lewis number: the mixture fraction is Z(r) = 1 − exp(−ṁ / (4π ρD r)), so the
 * flame sits where Z = Z_st:
 *
 *   r_f = ṁ / (4π ρD · ln(1 / (1 − Z_st))),   Z_st = 1 / (1 + ν·Y_F0 / Y_O∞)
 *
 * ṁ is the total (fuel + inert) mass flow. Z_st and the Burke–Schumann temperature are
 * checked against the values the PSI investigators report per test.
 */
import { Atmosphere, GASES, GAS, flameTemp, mixture, rhoD, stoichO2 } from "./props";

export interface BurnerTest {
  source: string;
  test: string | null;
  fuel: string;
  x_fuel: number;
  mfuel_mg_s: number;
  x_o2: number;
  p_kpa: number | null;
  zst: number | null;
  tad_k: number | null;
  burn_s: number | null;
  outcome: string | null;
}

/** Fuel mass fraction in a fuel/N2 supply of fuel mole fraction xF. */
export function fuelMassFraction(mwF: number, xF: number) {
  return (xF * mwF) / (xF * mwF + (1 - xF) * GAS.N2.mw);
}

export function burnerModel(fuelId: string, xFuel: number, mFuelMgS: number, a: Atmosphere, tests: BurnerTest[] = []) {
  const f = GASES[fuelId];
  const m = mixture(a);
  const yF0 = fuelMassFraction(f.mw, xFuel);
  const nuF = stoichO2(f);
  const { zst, tf } = flameTemp(a.tInf, m.yO2, nuF, f.q, m.cpHot, yF0);
  const mTot = (mFuelMgS * 1e-6) / yF0; // kg/s
  const rf = mTot / (4 * Math.PI * rhoD(m) * Math.log(1 / (1 - zst))); // m
  const heat = mFuelMgS * 1e-6 * f.q; // W

  const near = tests
    .filter((t) => t.fuel === fuelId)
    .map((t) => ({
      test: t,
      dist: Math.hypot(
        (t.x_o2 - a.xO2) * 100 / 3,
        ((t.p_kpa ?? 101.3) - a.pKpa) / 25,
        (t.x_fuel - xFuel) * 100 / 10,
        (t.mfuel_mg_s - mFuelMgS) / 0.5,
      ),
    }))
    .sort((x, y) => x.dist - y.dist)
    .slice(0, 6);
  const close = near.filter((n) => n.dist < 2.5);
  const outcomes = close.map((n) => n.test.outcome).filter(Boolean) as string[];
  return {
    fuel: f,
    zst,
    tf,
    rf: rf * 1e3, // mm
    heat,
    yF0,
    nearest: near,
    measured: {
      n: close.length,
      selfExt: outcomes.filter((o) => o === "self-extinguished").length,
      nOutcome: outcomes.length,
      zst: close.length ? close[0].test.zst : null,
      tad: close.length ? close[0].test.tad_k : null,
    },
  };
}
