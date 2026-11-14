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

## Repo state
- `ingest/psi_client.py`: rate-limited client for the endpoints above.
- `ingest/fetch_combustion.py`: caches records + test-matrix CSVs to `data/raw/`,
  writes `data/catalog.json`.
- `tests/test_fetch.py`: offline test with a fake client (passes).
- The ingest has NOT been run against the live API yet.

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
1. Run `python -m ingest.fetch_combustion`, check output, commit `data/`.
2. Inspect the real CSVs, then design one `tests` table schema (fuel, geometry,
   O2 %, pressure, flow speed, gravity, diagnostics) and write per-investigation
   normalisers, starting with BASS-II, Saffire and FLEX. Confirm priority with Nava.
3. Probe for a file-listing endpoint.
4. Then: retrieval + RAG agent, relevance ranking, flame visualiser, frontend.