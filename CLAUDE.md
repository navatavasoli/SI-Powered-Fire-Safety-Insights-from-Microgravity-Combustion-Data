# Crassus — project context

Portfolio project by Nava Tavasoli and Jennifer Campbell, based on a NASA hackathon challenge. A friend is designing the UI.

## Goal
An AI-powered, web-based dashboard over NASA's Physical Sciences Informatics (PSI)
combustion investigations that summarises, ranks and interprets them for spacecraft
fire safety. Target users: professors, students, aerospace researchers and engineers.

Challenge requirements to satisfy:
1. Identify investigations most relevant to fire safety in crewed habitats
   (spacecraft, stations, lunar/Martian bases, pressurised rovers).
2. Extract data that supports predictive modelling of flammability and fire scenarios.
3. Highlight research that informs next-generation fire-safety controls and equipment.
Optional: terrestrial fire-safety applications. Out of scope: rockets and propellants.

Personal additions beyond the challenge:
- A RAG-based agent that answers questions from the public PSI data, with citations.
- A flame visualiser for microgravity / electric-field conditions.

## Decisions made
- Flame visualiser: start with "tier 2", a reduced-order physics render in WebGL
  (spherical diffusion flame, Roper-style jet flame length, ion-wind body force for
  E-field). A trained generative image model (tier 3) is deferred: too few distinct
  conditions, and plausible fake flames are risky in a safety tool. Any synthetic
  output must be labelled as a model, not data.
- Budget: free. Proposed stack (not yet built, open to change):
  SQLite + local sentence-transformers embeddings + a free-tier hosted LLM
  (Groq or Gemini; current free limits NOT verified) behind a provider interface.
  FastAPI backend, Next.js frontend on Vercel. A vector DB is overkill at this size.
- The app reads a committed local cache in `data/`, never the live PSI API.
- Every AI answer must cite dataset DOIs (PSI requires citation by DOI).
- Nava prefers to agree on direction before large changes, and concise answers.

## Data source (verified in a browser on 2026-11-14)
PSI has no documented API. The site's own JSON backend is used instead; it is
undocumented and may change. Base: `https://psi.nasa.gov/geode-py/ws`
- `GET /repo/search?source=psi&type=investigation&size=500`
  Elasticsearch response; records in `hits.hits[]._source`. 133 investigations.
- `GET /repo/investigations/{ACCESSION}`
  Full record: objective, approach, hypothesis, researchImpacts, experimentHardware,
  doi, licenseIdentifier, totalFileSize, related_glds, publications[],
  experimentalTable[], images[].
- `GET /studies/{ACCESSION}/download?source=datamanager&file={file_name}`
  Downloads one named file. Verified on the PSI-22 experimental-table CSV only.
- Thumbnails: `GET /investigations/{ACCESSION}/image`.

Dead ends: the public S3 bucket `nasa-psi` contains only DSI, OASIS and pk4 (no
combustion). `GET /studies/{ACCESSION}` returns 403.

## What the data looks like
24 investigations are tagged Combustion Science, about 13.5 TB (see docs/INVENTORY.md):
19 flight (BASS, BASS-II, Saffire I-III, SAME, SAME-R, DAFT, FLEX, FLEX-2, CFI,
six ACME experiments, SPICE, SLICE) and 5 ground studies. Never download bulk data.

Known gaps:
- Test-matrix CSVs are hand-made: different columns per investigation, free-text
  notes, continuation rows. Each needs its own normaliser.
- Granularity varies. PSI-22 (E-FIELD) is per test day: fuel bottle, fuel
  concentration, mesh polarity, flames ignited. No voltage or flame-size values.
- No file-tree listing endpoint found yet for bulk data (video, sensor logs). The
  site JS references a POST `/files/v2` with {folder, fileType, studyId, version};
  untested. Needed to calibrate the flame visualiser against measurements.
- Publication DOIs are often blank; representative images exist for 5 of 24.
- PSI-10 has no licence field; the rest are CC0-1.0.

## Repo state (2026-11-14)
Pipeline (run from `backend/`, in order):
1. `python -m ingest.fetch_combustion` — caches PSI records + test-matrix CSVs to
   `data/raw/`, writes `data/catalog.json`. Run against the live API on 2026-11-14.
2. `python -m ingest.envelopes` — `data/derived/envelopes.json` (tested O2/P/flow/fuel
   ranges per investigation), `flex_tests.json` (262 FLEX droplet tests),
   `burner_tests.json` (326 Flame Design + CFI-G spherical-burner tests).
3. `python -m rag.index` — `data/index/` (224 chunks, Gemini embeddings; run from backend/).
Run: `python -m uvicorn api.main:app --port 8000` in `backend/` + `npm run dev` in `web/`.
LLM key goes in `.env` (see `.env.example`): GEMINI_API_KEY (Nava's choice) or GROQ_API_KEY.
The API re-reads `.env` until a model works, so adding a key needs no restart.
Without a key the copilot is retrieval-only.

- `rag/`: hybrid BM25 + dense retrieval (RRF), Gemini + Groq clients (each picks a model the key can use),
  grounded answers — findings whose citations don't match retrieved sources are dropped.
- `api/main.py`: FastAPI — investigations, flex/burner tests, chat, rank, safety.
- `web/`: Next.js 16 port of the CRASSUS prototype (design from friend's zip, MOCK
  services replaced). Physics in `web/lib/flame/` (TS, tested with vitest against PSI data).
- TLS: Norton antivirus intercepts HTTPS; `truststore` is injected in `psi_client.py`
  and `rag/__init__.py`. Node/npm worked without changes.
- `design/` holds Nava's design inputs. Applied: `halftone-nebula.tsx` -> landing hero
  (`web/components/HalftoneNebula.tsx`, Tailwind classes converted to inline styles, Solar
  preset, planet moved right); `CRASSUS Shield and Flame Logo.png` -> background keyed out to
  `web/public/brand/` (wordmark + mark) and `web/app/icon.png`.
  `ruixen-moon-chat.tsx` -> copilot panel (glass composer, pill quick-actions, centred welcome),
  recoloured to the Solar ember palette (Nava's choice); paperclip replaced by "New chat"
  (no uploads exist). `logo-marquee.tsx` -> `web/components/LogoMarquee.tsx` (hero strip) +
  static footer logos; `nasa-logo.png` had a baked-in checkerboard (flood-filled out) and
  `space-apps.png` a baked-in white background (keyed; black recoloured for dark UI) ->
  `web/public/logos/`. Footer states "not endorsed by NASA".
- Layout: Python backend in `backend/` (run from there), Next.js in `web/`; root `vercel.json`
  deploys both as Vercel Services (backend private; `/api` proxy in
  `web/app/api/[...path]/route.ts` rate-limits the copilot: 10/visitor/hour, 400/day).
- Deployed 2026-11-14: https://crassus-omega.vercel.app (Vercel project
  navatavasolis-projects/crassus, Services preset; GEMINI_API_KEY is a Production secret).
  Redeploy: `npx vercel@latest deploy --prod` from repo root.
- Embeddings: Gemini `gemini-embedding-2` (768-d). The local fastembed stack overflowed the
  225 MB Services function limit (230 MB), so retrieval switched to the API; `data/index/meta.json`
  records the embedder and queries must match it. Rebuild: `python -m rag.index` (needs key).
- Gemini generation: newest Flash models are often overloaded and hang; fallback walks the
  ranked list within a 55 s budget. Cold instances can take ~50 s for the first answer.

Flame-model calibration facts (worth knowing before changing physics):
- Droplet K: constant-property d²-law overpredicts FLEX by ~3× (heptane) / ~2× (methanol);
  fit ln(K/K_th) on P, X_CO2, He → scatter ±34 % heptane, ±12 % methanol. Theory gets the
  helium effect backwards; the fit corrects it.
- Flame T: Burke–Schumann + threshold dissociation fit (T0 = 2020 K) vs 324 PSI T_ad:
  RMS 631 K → 58 K; methane–air 2248 K vs textbook 2226 K (not in fit).
- Burner Z_st matches the investigators' per-test values (>80 % within 10 %).
- Solid-spread LOC is uncalibrated and likely non-conservative: labelled ILLUSTRATIVE.

## Domain notes for ranking and interpretation
- Hardware families: ACME experiments share the CIR; FLEX, FLEX-2, CFI use MDCA in
  the CIR (liquid droplets); BASS, BASS-II, SPICE, SLICE use the MSG flow duct.
- Most directly fire-safety relevant: BASS/BASS-II and Saffire (solid material
  flammability), SAME/SAME-R (smoke detection), FLEX (suppression by CO2/He
  dilution), ACME BRE (material flammability emulated with gas burners).
- Exploration atmospheres: Moon Base and rovers expected at >=30% O2 and <=10.2 psi,
  so high-O2 tests matter most. ACME CFI-G ran up to 85% O2.
- PSI has no partial-gravity data yet. E-FIELD Flames mimics it through ion wind;
  microgravity and 1 g results bound intermediate gravity.

## Next steps
1. Apply further design changes from `design/` as they arrive.
2. Add the Gemini key and review generated answers for grounding quality.
3. Calibrate solid spread (needs per-test extinction/spread outcomes — BASS-II CSV has
   O2 but no outcome column) and add a BRE flat-burner model.
4. Probe for a file-listing endpoint (`POST /files/v2`) to reach flame-size data.
5. Deployment: FastAPI host (embeddings need ~200 MB RAM) + Vercel for `web/`.