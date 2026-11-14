"""Step 2 of the pipeline: summarise each cached test matrix into a condition envelope.

Usage:  python -m ingest.envelopes [--data data]

Reads   data/catalog.json, data/raw/tables/<ACC>/*.csv
Writes  data/derived/envelopes.json   one row per investigation: O2 / pressure / flow
                                      ranges, fuels, test count (what PSI actually ran)
        data/derived/flex_tests.json  FLEX (PSI-69) droplet tests, fully normalised;
                                      used to calibrate and check the droplet model.

The CSVs are hand-made and differ per investigation, so columns are found by header
pattern and every number is pulled out of free text ("21; 26.5; 40", "~ 21.5",
"0.1 - 5"). Anything not reported stays None and is shown as "not reported".
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import re
from pathlib import Path

NUM = re.compile(r"(?<![\w.])-?\d+(?:\.\d+)?|(?<![\w\d])\.\d+")

# Pressure unit -> kPa
P_UNITS = {"atm": 101.325, "bar": 100.0, "mmhg": 0.133322, "psi": 6.89476, "kpa": 1.0}


def read_csv(path: Path) -> list[list[str]]:
    text = path.read_bytes().decode("utf-8-sig", errors="replace")
    rows = [[c.strip() for c in r] for r in csv.reader(io.StringIO(text))]
    return [r for r in rows if any(r)]


def numbers(cell: str) -> list[float]:
    return [float(m) for m in NUM.findall(cell or "")]


def find_col(header: list[str], include: str, exclude: str | None = None) -> int | None:
    for i, h in enumerate(header):
        if re.search(include, h, re.I) and not (exclude and re.search(exclude, h, re.I)):
            return i
    return None


def col_values(rows: list[list[str]], i: int | None) -> list[str]:
    if i is None:
        return []
    return [r[i] for r in rows[1:] if i < len(r) and r[i]]


def o2_percent(header: str, cells: list[str]) -> list[float]:
    out = []
    for c in cells:
        for v in numbers(c):
            # Mole fractions (<= 1) vs percent. Anything outside 5-100 % is not an O2 level.
            pct = v * 100 if v <= 1.0 else v
            if 5 <= pct <= 100:
                out.append(round(pct, 2))
    return out


def pressure_kpa(header: str, cells: list[str]) -> list[float]:
    out = []
    for c in cells:
        unit = next((u for u in P_UNITS if u in (c + " " + header).lower()), None)
        if unit is None:
            continue
        for v in numbers(c):
            if v > 0:
                out.append(round(v * P_UNITS[unit], 1))
    return out


def flow_ms(header: str, cells: list[str]) -> list[float]:
    """Flow speeds in m/s; only from columns or cells that state cm/s."""
    out = []
    for c in cells:
        if "cm/s" not in (c + " " + header).lower():
            continue
        out += [round(v / 100, 4) for v in numbers(c) if 0 <= v <= 500]
    return out


def fuels(cells: list[str]) -> list[str]:
    seen: dict[str, None] = {}
    for c in cells:
        # Drop trailing notes ("Kapton: same conditions as 1-4") and non-sample rows.
        c = re.sub(r"\s+", " ", c.split(":")[0]).strip()
        if re.match(r"pre-test|calibration", c, re.I):
            continue
        if c and c.lower() not in ("none", "n/a", "-") and len(seen) < 40:
            seen.setdefault(c, None)
    return list(seen)


def rng(vals: list[float]) -> list[float] | None:
    return [min(vals), max(vals)] if vals else None


def summarise_table(path: Path) -> dict:
    rows = read_csv(path)
    if len(rows) < 2:
        return {"file": path.name, "n_rows": 0}
    h = rows[0]
    o2_i = find_col(h, r"o2|oxygen|^o initial|atmosphere", r"final|after|flow rate|mg/s|co2")
    p_i = find_col(h, r"press|pmean|approx p|^p ", r"final")
    u_i = find_col(h, r"air ?flow|inlet velocity|flow velocity|air rate", r"restrictor")
    f_i = find_col(h, r"fuel(?! rate| mfc)|material|sample type", r"rate|mfc|number|#")
    return {
        "file": path.name,
        "n_rows": len(rows) - 1,
        "columns": h,
        "o2_pct": o2_percent(h[o2_i], col_values(rows, o2_i)) if o2_i is not None else [],
        "p_kpa": pressure_kpa(h[p_i], col_values(rows, p_i)) if p_i is not None else [],
        "u_ms": flow_ms(h[u_i], col_values(rows, u_i)) if u_i is not None else [],
        "fuels": fuels(col_values(rows, f_i)),
    }


def flex_tests(path: Path) -> list[dict]:
    """PSI-69 FLEX: one dict per droplet test with SI-ish units."""
    rows = read_csv(path)
    h = [c.lower() for c in rows[0]]

    def idx(pat: str) -> int:
        i = next((k for k, c in enumerate(h) if re.search(pat, c)), None)
        if i is None:
            raise KeyError(pat)
        return i

    I = {
        "id": idx(r"flex identifier"), "fuel": idx(r"^fuel"), "p": idx(r"pressure"),
        "o2": idx(r"^o initial"), "n2": idx(r"^n initial"), "co2": idx(r"^co initial"),
        "he": idx(r"^he initial"), "d0": idx(r"droplet initial"), "dext": idx(r"extinction"),
        "k": idx(r"burning rate"), "tb": idx(r"burn time"), "end": idx(r"test end"),
    }

    def num(r, k):
        v = numbers(r[I[k]]) if I[k] < len(r) else []
        return v[0] if v else None

    out = []
    for r in rows[1:]:
        o2, d0 = num(r, "o2"), num(r, "d0")
        if o2 is None or d0 is None:
            continue
        p = num(r, "p")
        out.append({
            "id": r[I["id"]], "fuel": r[I["fuel"]].strip(),
            "p_kpa": round(p * P_UNITS["mmhg"], 2) if p else None,
            "x_o2": o2, "x_n2": num(r, "n2") or 0.0, "x_co2": num(r, "co2") or 0.0,
            "x_he": num(r, "he") or 0.0,
            "d0_mm": d0, "dext_mm": num(r, "dext"),
            # Column header says "mm" but values are a d^2-law constant (mm^2/s).
            "k_mm2s": num(r, "k"), "tb_s": num(r, "tb"),
            "end": (r[I["end"]] if I["end"] < len(r) else "").strip() or None,
        })
    return out


FUEL_NAMES = {"c2h4": "ethylene", "c3h8": "propane", "ch4": "methane", "c2h6": "ethane"}


def burner_tests(path: Path, source: str) -> list[dict]:
    """Spherical porous-burner normal flames (ACME Flame Design PSI-10, CFI-G PSI-159)."""
    rows = read_csv(path)
    h = [c.strip().lower() for c in rows[0]]

    def idx(pat: str) -> int | None:
        return next((k for k, c in enumerate(h) if re.search(pat, c)), None)

    I = {"fuel": idx(r"^fuel$"), "xf": idx(r"^xf(uel)?$|^xf$"), "mf": idx(r"^mfuel|^mhc"),
         "o2": idx(r"xo2 ?\(init\)|xo2 +before"), "p_atm": idx(r"pmean"), "p_bar": idx(r"approx p"),
         "zst": idx(r"zst"), "tad": idx(r"tad"), "end": idx(r"self-ext"), "tb": idx(r"burn time"),
         "test": idx(r"^test$")}

    def num(r, k):
        i = I[k]
        v = numbers(r[i]) if i is not None and i < len(r) else []
        return v[0] if v else None

    out = []
    for r in rows[1:]:
        o2, mf = num(r, "o2"), num(r, "mf")
        if o2 is None or mf is None:
            continue  # ramped / continuation rows
        p = (num(r, "p_atm") or 0) * 101.325 or (num(r, "p_bar") or 0) * 100.0 or None
        fuel = (r[I["fuel"]] if I["fuel"] is not None else "").strip().lower()
        fuel = re.sub(r"^\d+(?:\.\d+)?\s*%\s*", "", fuel)  # "30% butane": dilution is in Xf
        end = (r[I["end"]] if I["end"] is not None and I["end"] < len(r) else "").strip().upper()
        out.append({
            "source": source, "test": r[I["test"]] if I["test"] is not None else None,
            "fuel": FUEL_NAMES.get(fuel, fuel), "x_fuel": num(r, "xf") if num(r, "xf") is not None else 1.0,
            "mfuel_mg_s": mf, "x_o2": o2, "p_kpa": round(p, 1) if p else None,
            "zst": num(r, "zst"), "tad_k": num(r, "tad"), "burn_s": num(r, "tb"),
            "outcome": {"SE": "self-extinguished", "FT": "flow terminated"}.get(end[:2]) if end else None,
        })
    return out


def run(data: Path) -> list[dict]:
    catalog = json.loads((data / "catalog.json").read_text(encoding="utf-8"))
    envs = []
    for c in catalog:
        acc = c["accession"]
        tables = sorted((data / "raw" / "tables" / acc).glob("*.csv")) if (data / "raw" / "tables" / acc).exists() else []
        parts = [summarise_table(t) for t in tables]
        o2 = [v for p in parts for v in p.get("o2_pct", [])]
        pk = [v for p in parts for v in p.get("p_kpa", [])]
        u = [v for p in parts for v in p.get("u_ms", [])]
        fu = list(dict.fromkeys(f for p in parts for f in p.get("fuels", [])))
        envs.append({
            "accession": acc, "acronym": c.get("acronym"), "title": c.get("title"),
            "doi": c.get("doi"), "platform": c.get("platform"), "hardware": c.get("hardware"),
            "sub_area": c.get("sub_area"), "project_type": c.get("project_type"),
            "n_tests": sum(p.get("n_rows", 0) for p in parts),
            "tables": [{"file": p["file"], "n_rows": p.get("n_rows", 0), "columns": p.get("columns", [])} for p in parts],
            "o2_pct": rng(o2), "o2_levels": sorted(set(o2))[:40],
            "p_kpa": rng(pk), "u_ms": rng(u),
            "fuels": fu,
            # PSI has no partial-gravity combustion data; every flight test is microgravity.
            "gravity": "µg" if "microgravity" in (c.get("project_type") or "").lower() else "1 g / ground",
        })

    out = data / "derived"
    out.mkdir(parents=True, exist_ok=True)
    (out / "envelopes.json").write_text(json.dumps(envs, indent=1, ensure_ascii=False), encoding="utf-8")

    flex = data / "raw" / "tables" / "PSI-69" / "PSI-69_Experimental table_FLEX.csv"
    if flex.exists():
        tests = flex_tests(flex)
        (out / "flex_tests.json").write_text(json.dumps(tests, indent=1), encoding="utf-8")
        print(f"FLEX: {len(tests)} droplet tests -> {out / 'flex_tests.json'}")

    burners = []
    for acc, name, src in [("PSI-10", "PSI-10_Experimental table_Flame Design_Normal Flame.csv", "Flame Design"),
                           ("PSI-159", "PSI-159_Experimental table_CFI-G_Normal Flames.csv", "CFI-G")]:
        f = data / "raw" / "tables" / acc / name
        if f.exists():
            burners += burner_tests(f, src)
    if burners:
        (out / "burner_tests.json").write_text(json.dumps(burners, indent=1), encoding="utf-8")
        print(f"Burner: {len(burners)} spherical-burner tests -> {out / 'burner_tests.json'}")
    print(f"{len(envs)} envelopes -> {out / 'envelopes.json'}")
    return envs


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--data", type=Path, default=Path("data"))
    a = ap.parse_args()
    for e in run(a.data):
        print(f"  {e['accession']:8} {str(e['acronym'] or '-'):18} n={e['n_tests']:4}  O2={e['o2_pct']}  p={e['p_kpa']}  u={e['u_ms']}  fuels={e['fuels'][:4]}")
